import type { FacePoint, LandmarkerFrame } from '../core/types';

type WorkerResult = { type: 'ready' } | { type: 'error'; message: string } | { type: 'result'; faces: FacePoint[][]; blendshapes: LandmarkerFrame['blendshapes']; timestamp: number; inferenceMs: number };

export class LandmarkerClient {
  private worker = new Worker(new URL('./landmarker.worker.ts', import.meta.url), { type: 'module' });
  private listeners = new Set<(message: WorkerResult) => void>();
  constructor() {
    this.worker.onmessage = event => this.listeners.forEach(listener => listener(event.data as WorkerResult));
    this.worker.onerror = event => this.listeners.forEach(listener => listener({ type: 'error', message: event.message || 'Worker failed' }));
  }
  subscribe(listener: (message: WorkerResult) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  init() {
    const base = new URL(import.meta.env.BASE_URL, location.href);
    this.worker.postMessage({ type: 'init', modelUrl: new URL('models/face_landmarker.task', base).href, wasmUrl: new URL('wasm/', base).href });
  }
  async sendFrame(video: HTMLVideoElement, timestamp: number) {
    const bitmap = await createImageBitmap(video);
    this.worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
  }
  close() { this.worker.postMessage({ type: 'close' }); }
}
