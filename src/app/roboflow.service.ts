import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RoboflowConfig, RoboflowResponse, VisionTask } from './roboflow.models';

/**
 * Thin wrapper around the Roboflow hosted inference API.
 *
 * Vision models are reached through task-specific subdomains and receive a
 * base64-encoded image as the request body. Text / document models have no
 * universal Roboflow endpoint, so a user-supplied URL is called with a JSON
 * body instead.
 */
@Injectable({ providedIn: 'root' })
export class RoboflowService {
  private readonly http = inject(HttpClient);

  /** Maps each vision task to the hosted inference subdomain that serves it. */
  private domainFor(task: VisionTask): string {
    switch (task) {
      case 'instance-segmentation':
        return 'https://outline.roboflow.com';
      case 'semantic-segmentation':
        return 'https://segment.roboflow.com';
      case 'classification':
        return 'https://classify.roboflow.com';
      case 'object-detection':
      default:
        return 'https://detect.roboflow.com';
    }
  }

  /** Builds the fully-qualified model URL, e.g. detect.roboflow.com/proj/3. */
  modelUrl(config: RoboflowConfig): string {
    const base = this.domainFor(config.visionTask);
    const project = encodeURIComponent(config.project.trim());
    const version = encodeURIComponent(config.version.trim());
    const params = new URLSearchParams({
      api_key: config.apiKey.trim(),
      format: 'json',
      confidence: String(config.confidence),
      overlap: String(config.overlap),
    });
    return `${base}/${project}/${version}?${params.toString()}`;
  }

  /**
   * Runs inference on an image. `base64` must be the raw base64 payload with
   * the `data:` URI prefix already stripped — the format the hosted API wants.
   */
  inferImage(config: RoboflowConfig, base64: string): Observable<RoboflowResponse> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    return this.http.post<RoboflowResponse>(this.modelUrl(config), base64, { headers });
  }

  /**
   * Runs inference on a text / document payload against a user-supplied
   * endpoint. The api key is sent as a query parameter to mirror the vision
   * API; the text is sent as a JSON body.
   */
  inferText(config: RoboflowConfig, text: string): Observable<RoboflowResponse> {
    const endpoint = config.textEndpoint.trim();
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${endpoint}${separator}api_key=${encodeURIComponent(config.apiKey.trim())}`;
    return this.http.post<RoboflowResponse>(url, { text });
  }
}
