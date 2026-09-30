export type Stage = 'intro' | 'cameraPermission' | 'loading' | 'calibration' | 'frontScan' | 'leftScan' | 'rightScan' | 'ready' | 'report' | 'error';
export type FacePoint = { x: number; y: number; z?: number };
export type Blendshape = { categoryName?: string; score?: number };
export type LandmarkerFrame = {
  faces: FacePoint[][];
  blendshapes: Blendshape[][];
  timestamp: number;
  inferenceMs: number;
};
export type FaceQuality = 'good' | 'no-face' | 'multiple-faces' | 'out-of-frame' | 'too-small' | 'tilted' | 'not-frontal' | 'unstable';
export type FeatureSample = {
  symmetryError: number;
  widthHeightRatio: number;
  eyeSpacingRatio: number;
  timestamp: number;
};
export type MetricResult = {
  id: 'symmetry' | 'face-proportion' | 'eye-spacing';
  title: string;
  score: number;
  description: string;
  rawValue: number;
  displayValue: string;
  weight: number;
};
export type Assessment = {
  overall: number | null;
  metrics: MetricResult[];
  confidence: number;
  confidenceLabel: string;
  sampleCount: number;
  strengths: string[];
  recommendations: string[];
  sideNotes: string[];
};
export type ScanData = { front: FeatureSample[]; leftFrames: number; rightFrames: number; sideNotes: string[] };
export type MotionEvent = 'nod' | 'left-turn' | 'right-turn' | 'double-blink' | 'long-blink';
export type AppError = { title: string; message: string; recoverable: boolean };
