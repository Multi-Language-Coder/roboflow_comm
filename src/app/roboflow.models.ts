/**
 * Shared types describing the Roboflow configuration, the data the user
 * submits, and the (loosely typed) responses the inference servers return.
 */

/** The kind of data the user is submitting for inference. */
export type InputKind = 'image' | 'video' | 'text';

/**
 * The task the deployed Roboflow model performs. This drives both the
 * inference endpoint that is called and how the result is rendered.
 */
export type VisionTask =
  | 'object-detection'
  | 'instance-segmentation'
  | 'semantic-segmentation'
  | 'classification';

/** Credentials + project coordinates needed to reach a deployed model. */
export interface RoboflowConfig {
  workspace: string;
  project: string;
  version: string;
  apiKey: string;
  inputKind: InputKind;
  visionTask: VisionTask;
  /** Optional overrides passed to the hosted inference API. */
  confidence: number;
  overlap: number;
  /** Endpoint used for text / document models (no universal Roboflow default). */
  textEndpoint: string;
}

/** A single detection / segmentation / classification prediction. */
export interface RoboflowPrediction {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  class?: string;
  class_id?: number;
  confidence?: number;
  detection_id?: string;
  /** Present for instance segmentation models. */
  points?: { x: number; y: number }[];
  [key: string]: unknown;
}

/** Loose shape of the JSON the hosted inference API returns. */
export interface RoboflowResponse {
  predictions?: RoboflowPrediction[] | Record<string, { confidence: number }>;
  image?: { width: number; height: number };
  /** Classification convenience fields. */
  top?: string;
  confidence?: number;
  predicted_classes?: string[];
  /** Semantic segmentation returns a base64-encoded mask. */
  segmentation_mask?: string;
  class_map?: Record<string, string>;
  /** Text / token models may return entity spans; schema varies by model. */
  entities?: TextEntity[];
  [key: string]: unknown;
}

/**
 * A highlighted span within a text input. Different Roboflow / hosted text
 * models name these fields differently, so the parser is defensive.
 */
export interface TextEntity {
  start: number;
  end: number;
  label: string;
  text?: string;
  confidence?: number;
}

/** The default confidence / overlap thresholds used by the hosted API. */
export const DEFAULT_CONFIG: RoboflowConfig = {
  workspace: '',
  project: '',
  version: '1',
  apiKey: '',
  inputKind: 'image',
  visionTask: 'object-detection',
  confidence: 40,
  overlap: 30,
  textEndpoint: '',
};
