import { CONFIG } from './config';
import type { FacePoint } from './types';

type AnchorFrame = { centerX: number; centerY: number; width: number };

export class TemporalStabilityGate {
  private frames: AnchorFrame[] = [];

  update(points: FacePoint[] | null, aspect: number) {
    if (!points || points.length < 455 || !Number.isFinite(aspect) || aspect <= 0) {
      this.reset();
      return false;
    }
    const leftEye = points[33]; const rightEye = points[263];
    const leftFace = points[234]; const rightFace = points[454];
    const current = {
      centerX: ((leftEye.x + rightEye.x) / 2) * aspect,
      centerY: (leftEye.y + rightEye.y) / 2,
      width: (rightFace.x - leftFace.x) * aspect,
    };
    if (![current.centerX, current.centerY, current.width].every(Number.isFinite) || current.width <= 0) {
      this.reset(); return false;
    }
    this.frames.push(current);
    if (this.frames.length > CONFIG.stabilityFrames) this.frames.shift();
    if (this.frames.length < CONFIG.stabilityFrames) return false;
    const center = this.frames[0];
    const meanWidth = this.frames.reduce((sum, frame) => sum + frame.width, 0) / this.frames.length;
    const maxCenterDrift = Math.max(...this.frames.map(frame => Math.hypot(frame.centerX - center.centerX, frame.centerY - center.centerY)));
    const scaleRange = Math.max(...this.frames.map(frame => frame.width)) - Math.min(...this.frames.map(frame => frame.width));
    return maxCenterDrift / meanWidth <= CONFIG.stabilityCenterTolerance && scaleRange / meanWidth <= CONFIG.stabilityScaleTolerance;
  }

  reset() { this.frames = []; }
}
