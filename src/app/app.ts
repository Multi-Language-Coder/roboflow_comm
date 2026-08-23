import {
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { RoboflowService } from './roboflow.service';
import {
  DEFAULT_CONFIG,
  InputKind,
  RoboflowConfig,
  RoboflowPrediction,
  RoboflowResponse,
  TextEntity,
  VisionTask,
} from './roboflow.models';

/** A normalized class + confidence pair used by the classification view. */
interface ClassScore {
  label: string;
  confidence: number;
}

/** A run of text, flagged as highlighted (an entity) or plain. */
interface TextSegment {
  text: string;
  entity?: TextEntity;
}

@Component({
  selector: 'app-root',
  imports: [FormsModule, JsonPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly roboflow = inject(RoboflowService);

  /** Two-way bound form model. */
  protected readonly config: RoboflowConfig = { ...DEFAULT_CONFIG };

  // --- Input state -----------------------------------------------------------
  /** Data URL of the image (or captured video frame) to run/overlay on. */
  protected readonly imageUrl = signal<string | null>(null);
  /** Object URL of a selected video file. */
  protected readonly videoUrl = signal<string | null>(null);
  /** Raw text the user typed for text/document models. */
  protected textInput = '';

  // --- Request state ---------------------------------------------------------
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<RoboflowResponse | null>(null);
  protected readonly rawExpanded = signal(false);
  /** The text that was actually sent, so highlight offsets stay aligned. */
  protected readonly submittedText = signal('');

  // --- View refs -------------------------------------------------------------
  private readonly baseImage = viewChild<ElementRef<HTMLImageElement>>('baseImage');
  private readonly overlay = viewChild<ElementRef<HTMLCanvasElement>>('overlay');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  // --- Derived views ---------------------------------------------------------

  /**
   * True when the current model overlays results on a picture. This reads the
   * plain `config` object (not a signal), so it must be a method that the
   * template re-evaluates each change-detection pass rather than a computed.
   */
  protected isVisual(): boolean {
    return this.config.inputKind === 'image' || this.config.inputKind === 'video';
  }

  /** Classification scores, normalized from the various response shapes. */
  protected readonly classScores = computed<ClassScore[]>(() => {
    const res = this.result();
    if (!res) return [];
    const scores: ClassScore[] = [];
    const preds = res.predictions;
    if (Array.isArray(preds)) {
      for (const p of preds) {
        if (p.class && typeof p.confidence === 'number' && p.x === undefined) {
          scores.push({ label: p.class, confidence: p.confidence });
        }
      }
    } else if (preds && typeof preds === 'object') {
      // Classification API returns a { className: { confidence } } map.
      for (const [label, value] of Object.entries(preds)) {
        scores.push({ label, confidence: value?.confidence ?? 0 });
      }
    }
    return scores.sort((a, b) => b.confidence - a.confidence);
  });

  /** Text broken into highlighted / plain runs for entity rendering. */
  protected readonly textSegments = computed<TextSegment[]>(() => {
    const res = this.result();
    const text = this.submittedText();
    if (!res || !text) return [];
    const entities = this.parseEntities(res, text);
    if (entities.length === 0) return [{ text }];

    const sorted = [...entities]
      .filter((e) => e.start >= 0 && e.end > e.start && e.end <= text.length)
      .sort((a, b) => a.start - b.start);

    const segments: TextSegment[] = [];
    let cursor = 0;
    for (const entity of sorted) {
      if (entity.start < cursor) continue; // skip overlapping spans
      if (entity.start > cursor) {
        segments.push({ text: text.slice(cursor, entity.start) });
      }
      segments.push({ text: text.slice(entity.start, entity.end), entity });
      cursor = entity.end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor) });
    return segments;
  });

  /** Semantic-segmentation mask as a data URL, if the response carried one. */
  protected readonly maskUrl = computed<string | null>(() => {
    const mask = this.result()?.segmentation_mask;
    if (!mask) return null;
    return mask.startsWith('data:') ? mask : `data:image/png;base64,${mask}`;
  });

  // --- Input handlers --------------------------------------------------------

  protected onInputKindChange(kind: InputKind): void {
    this.config.inputKind = kind;
    // Sensible default task per input kind.
    if (kind === 'text') {
      this.config.visionTask = 'classification';
    } else if (this.config.visionTask === 'classification') {
      this.config.visionTask = 'object-detection';
    }
    this.reset();
    this.imageUrl.set(null);
    this.videoUrl.set(null);
  }

  protected onImageSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.reset();
    const reader = new FileReader();
    reader.onload = () => this.imageUrl.set(reader.result as string);
    reader.readAsDataURL(file);
  }

  protected onVideoSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.reset();
    this.imageUrl.set(null);
    this.videoUrl.set(URL.createObjectURL(file));
  }

  // --- Inference -------------------------------------------------------------

  protected canRun(): boolean {
    if (this.loading()) return false;
    if (!this.config.project.trim() || !this.config.apiKey.trim()) return false;
    if (this.config.inputKind === 'text') {
      return !!this.textInput.trim() && !!this.config.textEndpoint.trim();
    }
    if (this.config.inputKind === 'video') {
      return !!this.videoUrl();
    }
    return !!this.imageUrl();
  }

  protected run(): void {
    this.error.set(null);
    this.result.set(null);

    if (this.config.inputKind === 'text') {
      this.runText();
    } else if (this.config.inputKind === 'video') {
      this.runVideo();
    } else {
      this.runImage();
    }
  }

  private runImage(): void {
    const dataUrl = this.imageUrl();
    if (!dataUrl) return;
    this.loading.set(true);
    const base64 = dataUrl.split(',')[1] ?? '';
    this.roboflow.inferImage(this.config, base64).subscribe({
      next: (res) => {
        this.result.set(res);
        this.loading.set(false);
        queueMicrotask(() => this.drawOverlay());
      },
      error: (err) => this.fail(err),
    });
  }

  private runVideo(): void {
    // The browser cannot stream a whole video to the hosted API, so we grab
    // the current frame and run image inference on it.
    const videoEl = this.video()?.nativeElement;
    if (!videoEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    if (!canvas.width || !canvas.height) {
      this.error.set('Play or seek the video to a frame before running inference.');
      return;
    }
    canvas.getContext('2d')?.drawImage(videoEl, 0, 0);
    const frameUrl = canvas.toDataURL('image/jpeg', 0.92);
    this.imageUrl.set(frameUrl); // becomes the base picture for the overlay
    this.loading.set(true);
    const base64 = frameUrl.split(',')[1] ?? '';
    this.roboflow.inferImage(this.config, base64).subscribe({
      next: (res) => {
        this.result.set(res);
        this.loading.set(false);
        queueMicrotask(() => this.drawOverlay());
      },
      error: (err) => this.fail(err),
    });
  }

  private runText(): void {
    this.loading.set(true);
    const text = this.textInput;
    this.roboflow.inferText(this.config, text).subscribe({
      next: (res) => {
        this.submittedText.set(text);
        this.result.set(res);
        this.loading.set(false);
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.loading.set(false);
    const e = err as { status?: number; message?: string; error?: unknown };
    let msg = e?.message ?? 'Request failed.';
    if (e?.status === 0) {
      msg = 'Network / CORS error — could not reach the inference server.';
    } else if (e?.status === 401 || e?.status === 403) {
      msg = 'Unauthorized — check the API key and that the model is deployed.';
    } else if (e?.status === 404) {
      msg = 'Not found — check the project name and version number.';
    }
    if (typeof e?.error === 'string') msg += ` (${e.error})`;
    this.error.set(msg);
  }

  private reset(): void {
    this.result.set(null);
    this.error.set(null);
    this.submittedText.set('');
  }

  // --- Overlay rendering -----------------------------------------------------

  /** Called on image load so the canvas matches the picture and draws boxes. */
  protected onBaseImageLoad(): void {
    this.drawOverlay();
  }

  private drawOverlay(): void {
    const res = this.result();
    const img = this.baseImage()?.nativeElement;
    const canvas = this.overlay()?.nativeElement;
    if (!res || !img || !canvas || !img.naturalWidth) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const preds = res.predictions;
    if (!Array.isArray(preds)) return;

    // Roboflow reports coordinates in the space it processed; scale to natural.
    const sx = res.image?.width ? img.naturalWidth / res.image.width : 1;
    const sy = res.image?.height ? img.naturalHeight / res.image.height : 1;
    const font = Math.max(14, Math.round(img.naturalHeight / 40));
    ctx.lineWidth = Math.max(2, Math.round(img.naturalHeight / 300));
    ctx.font = `${font}px sans-serif`;

    for (const p of preds) {
      const color = this.colorFor(p.class ?? '');
      if (p.points && p.points.length > 1) {
        this.drawPolygon(ctx, p, color, sx, sy);
      } else if (p.width && p.height && p.x !== undefined && p.y !== undefined) {
        this.drawBox(ctx, p, color, sx, sy, font);
      }
    }
  }

  private drawBox(
    ctx: CanvasRenderingContext2D,
    p: RoboflowPrediction,
    color: string,
    sx: number,
    sy: number,
    font: number,
  ): void {
    const w = p.width! * sx;
    const h = p.height! * sy;
    const left = p.x! * sx - w / 2;
    const top = p.y! * sy - h / 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(left, top, w, h);

    const label = `${p.class ?? 'object'} ${this.pct(p.confidence)}`;
    const padding = font * 0.3;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(left, top - font - padding * 2, textWidth + padding * 2, font + padding * 2);
    ctx.fillStyle = '#0b1020';
    ctx.fillText(label, left + padding, top - padding);
  }

  private drawPolygon(
    ctx: CanvasRenderingContext2D,
    p: RoboflowPrediction,
    color: string,
    sx: number,
    sy: number,
  ): void {
    ctx.beginPath();
    p.points!.forEach((pt, i) => {
      const x = pt.x * sx;
      const y = pt.y * sy;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.fillStyle = this.colorFor(p.class ?? '', 0.3);
    ctx.fill();
    ctx.stroke();
  }

  // --- Helpers ---------------------------------------------------------------

  /** Reads the various entity shapes text models return into a common form. */
  private parseEntities(res: RoboflowResponse, text: string): TextEntity[] {
    if (Array.isArray(res.entities)) {
      return res.entities.filter((e) => typeof e.start === 'number');
    }
    const preds = res.predictions;
    if (Array.isArray(preds)) {
      const spans = preds.filter(
        (p) => typeof p['start'] === 'number' && typeof p['end'] === 'number',
      );
      if (spans.length) {
        return spans.map((p) => ({
          start: p['start'] as number,
          end: p['end'] as number,
          label: p.class ?? 'entity',
          confidence: p.confidence,
        }));
      }
      // Fall back to matching predicted class strings within the text.
      return this.matchByText(preds, text);
    }
    return [];
  }

  /** When a model returns class names but no offsets, locate them in the text. */
  private matchByText(preds: RoboflowPrediction[], text: string): TextEntity[] {
    const entities: TextEntity[] = [];
    for (const p of preds) {
      const needle = (p['text'] as string) ?? p.class;
      if (!needle) continue;
      const idx = text.indexOf(needle);
      if (idx >= 0) {
        entities.push({
          start: idx,
          end: idx + needle.length,
          label: p.class ?? 'entity',
          confidence: p.confidence,
        });
      }
    }
    return entities;
  }

  /** Deterministic color per class name (HSL, optionally translucent). */
  protected colorFor(name: string, alpha = 1): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsla(${hue}, 85%, 60%, ${alpha})`;
  }

  protected pct(confidence?: number): string {
    if (typeof confidence !== 'number') return '';
    return `${(confidence * 100).toFixed(1)}%`;
  }

  protected toggleRaw(): void {
    this.rawExpanded.update((v) => !v);
  }

  protected readonly visionTasks: { value: VisionTask; label: string }[] = [
    { value: 'object-detection', label: 'Object Detection' },
    { value: 'instance-segmentation', label: 'Instance Segmentation' },
    { value: 'semantic-segmentation', label: 'Semantic Segmentation' },
    { value: 'classification', label: 'Classification' },
  ];
}
