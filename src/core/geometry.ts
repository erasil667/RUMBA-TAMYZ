import { CONFIG, LANDMARKS } from './config';
import type { FacePoint, FaceQuality, FeatureSample } from './types';

const point = (p: FacePoint[], id: number) => p[id];
const imageDistance = (a: FacePoint, b: FacePoint, aspect: number) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function faceGeometry(p: FacePoint[], aspect = 4 / 3) {
  const eyeMid = (point(p, LANDMARKS.eyeOuterLeft).x + point(p, LANDMARKS.eyeOuterRight).x) / 2;
  const eyeSpan = Math.abs(point(p, LANDMARKS.eyeOuterRight).x - point(p, LANDMARKS.eyeOuterLeft).x);
  const nose = point(p, LANDMARKS.noseTip);
  const screenYaw = eyeSpan > 0 ? -(nose.x - eyeMid) / eyeSpan : 0;
  const eyeL = point(p, LANDMARKS.rollLeft);
  const eyeR = point(p, LANDMARKS.rollRight);
  const rollDeg = Math.atan2(eyeR.y - eyeL.y, (eyeR.x - eyeL.x) * aspect) * 180 / Math.PI;
  const eyeLineY = (eyeL.y + eyeR.y) / 2;
  const faceHeight = Math.abs(point(p, LANDMARKS.chin).y - point(p, LANDMARKS.forehead).y);
  const nosePitch = faceHeight > 0 ? (nose.y - eyeLineY) / faceHeight : 0;
  const box = p.slice(0, 468).reduce((b, q) => ({
    minX: Math.min(b.minX, q.x), minY: Math.min(b.minY, q.y),
    maxX: Math.max(b.maxX, q.x), maxY: Math.max(b.maxY, q.y),
  }), { minX: 1, minY: 1, maxX: 0, maxY: 0 });
  return { screenYaw, rollDeg, nosePitch, faceHeight, faceWidth: box.maxX - box.minX, box };
}

export function assessFrame(faces: FacePoint[][]): { quality: FaceQuality; points?: FacePoint[]; geometry?: ReturnType<typeof faceGeometry> } {
  if (!faces.length) return { quality: 'no-face' };
  if (faces.length > 1) return { quality: 'multiple-faces' };
  const points = faces[0];
  if (points.length < CONFIG.landmarkCount) return { quality: 'no-face' };
  const geometry = faceGeometry(points);
  const { box } = geometry;
  if (box.minX < CONFIG.safeMargin || box.maxX > 1 - CONFIG.safeMargin || box.minY < CONFIG.safeMargin || box.maxY > 1 - CONFIG.safeMargin) {
    return { quality: 'out-of-frame', points, geometry };
  }
  if (geometry.faceWidth < CONFIG.minFaceWidth) return { quality: 'too-small', points, geometry };
  if (Math.abs(geometry.rollDeg) > CONFIG.neutralRollDeg) return { quality: 'tilted', points, geometry };
  return { quality: 'good', points, geometry };
}

export function extractFrontFeatures(p: FacePoint[], timestamp: number, aspect = 4 / 3): FeatureSample | null {
  const g = faceGeometry(p, aspect);
  if (Math.abs(g.screenYaw) > CONFIG.frontalYaw || Math.abs(g.rollDeg) > CONFIG.frontRollDeg || g.faceHeight < 0.22) return null;
  const eyeSpan = imageDistance(point(p, LANDMARKS.eyeOuterLeft), point(p, LANDMARKS.eyeOuterRight), aspect);
  const faceWidth = imageDistance(point(p, LANDMARKS.faceLeft), point(p, LANDMARKS.faceRight), aspect);
  const faceHeight = imageDistance(point(p, LANDMARKS.forehead), point(p, LANDMARKS.chin), aspect);
  if (eyeSpan < 0.04 || faceWidth < 0.12 || faceHeight < 0.18) return null;
  const midX = (point(p, LANDMARKS.eyeOuterLeft).x + point(p, LANDMARKS.eyeOuterRight).x) / 2;
  const symmetryError = LANDMARKS.symmetryPairs.reduce((sum, [aId, bId]) => {
    const a = point(p, aId); const b = point(p, bId);
    return sum + Math.hypot((Math.abs(a.x - midX) - Math.abs(b.x - midX)) * aspect, a.y - b.y) / faceWidth;
  }, 0) / LANDMARKS.symmetryPairs.length;
  const eyeGap = imageDistance(point(p, LANDMARKS.eyeInnerLeft), point(p, LANDMARKS.eyeInnerRight), aspect);
  return {
    symmetryError: clamp(symmetryError, 0, 1),
    widthHeightRatio: faceWidth / faceHeight,
    eyeSpacingRatio: eyeGap / eyeSpan,
    timestamp,
  };
}
