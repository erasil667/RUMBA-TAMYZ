import { describe, expect, it } from 'vitest';
import { MotionRecognizer } from './motion';
import { calculateAssessment, scoreInternals } from './scoring';
import { applyScanTick, initialScanState } from './scanMachine';
import { TemporalStabilityGate } from './stability';
import type { Blendshape, FeatureSample } from './types';

const sample = (timestamp: number, overrides: Partial<FeatureSample> = {}): FeatureSample => ({ symmetryError: 0.015, widthHeightRatio: 0.75, eyeSpacingRatio: 0.4, timestamp, ...overrides });
const blink = (left: number, right: number): Blendshape[] => [{ categoryName: 'eyeBlinkLeft', score: left }, { categoryName: 'eyeBlinkRight', score: right }];

describe('deterministic scoring', () => {
  it('returns the same score for identical samples and weights the published components', () => {
    const frames = Array.from({ length: 36 }, (_, i) => sample(i * 100));
    const a = calculateAssessment(frames, 10, 10);
    const b = calculateAssessment(frames, 10, 10);
    expect(a).toEqual(b);
    expect(a.overall).toBe(87);
    expect(a.metrics.map(m => m.id)).toEqual(['symmetry', 'face-proportion', 'eye-spacing']);
  });
  it('does not invent a score below the minimum frame count', () => {
    const result = calculateAssessment(Array.from({ length: 17 }, (_, i) => sample(i)), 10, 10);
    expect(result.overall).toBeNull();
    expect(result.metrics).toHaveLength(0);
  });
  it('uses the declared piecewise product bands', () => {
    expect(scoreInternals.intervalScore(0.75, [0.66, 0.86], [0.5, 1.02])).toBe(100);
    expect(scoreInternals.intervalScore(0.5, [0.66, 0.86], [0.5, 1.02])).toBe(0);
    expect(scoreInternals.intervalScore(0.58, [0.66, 0.86], [0.5, 1.02])).toBe(50);
  });
});

describe('motion sequences', () => {
  it('requires a sustained turn and emits one event only', () => {
    const detector = new MotionRecognizer();
    let event: string | undefined;
    for (let now = 0; now <= 1800; now += 100) {
      const result = detector.update({ stage: 'leftScan', yaw: -0.23, pitch: 0, rollDeg: 0, blendshapes: blink(0, 0), now });
      event = result.event ?? event;
    }
    expect(event).toBe('left-turn');
    expect(detector.update({ stage: 'leftScan', yaw: -0.23, pitch: 0, rollDeg: 0, blendshapes: blink(0, 0), now: 1900 }).event).toBeUndefined();
  });
  it('recognizes a down-and-return nod after neutral calibration', () => {
    const detector = new MotionRecognizer();
    let result = detector.update({ stage: 'calibration', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: [], now: 0 });
    for (let now = 100; now <= 900; now += 100) result = detector.update({ stage: 'calibration', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: [], now });
    expect(result.holdProgress).toBe(1);
    expect(result.cue).toContain('Нейтраль запомнена');
    let event: string | undefined;
    for (let now = 1000; now <= 1900; now += 100) result = detector.update({ stage: 'calibration', yaw: 0, pitch: 0.2, rollDeg: 0, blendshapes: [], now });
    expect(result.cue).toContain('верни голову прямо');
    for (let now = 2000; now <= 3000; now += 100) event = detector.update({ stage: 'calibration', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: [], now }).event ?? event;
    expect(event).toBe('nod');
  });
  it('explains an upward head tilt instead of silently waiting for the nod', () => {
    const detector = new MotionRecognizer();
    for (let now = 0; now <= 900; now += 100) detector.update({ stage: 'calibration', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: [], now });
    detector.update({ stage: 'calibration', yaw: 0, pitch: -0.2, rollDeg: 0, blendshapes: [], now: 1000 });
    const result = detector.update({ stage: 'calibration', yaw: 0, pitch: -0.2, rollDeg: 0, blendshapes: [], now: 1100 });
    expect(result.cue).toContain('Не запрокидывай голову');
  });
  it('identifies the opposite turn direction without accepting it', () => {
    const detector = new MotionRecognizer();
    let result = detector.update({ stage: 'leftScan', yaw: 0.22, pitch: 0, rollDeg: 0, blendshapes: [], now: 1000 });
    for (let now = 1100; now <= 1400; now += 100) result = detector.update({ stage: 'leftScan', yaw: 0.22, pitch: 0, rollDeg: 0, blendshapes: [], now });
    expect(result.cue).toContain('другую сторону');
    expect(result.event).toBeUndefined();
  });
  it('distinguishes a double blink from a long blink', () => {
    const double = new MotionRecognizer();
    double.update({ stage: 'ready', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: blink(0.9, 0.9), now: 1000 });
    double.update({ stage: 'ready', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: blink(0, 0), now: 1120 });
    double.update({ stage: 'ready', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: blink(0.9, 0.9), now: 1300 });
    expect(double.update({ stage: 'ready', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: blink(0, 0), now: 1420 }).event).toBe('double-blink');
    const repeat = new MotionRecognizer();
    repeat.update({ stage: 'report', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: blink(0.9, 0.9), now: 2000 });
    expect(repeat.update({ stage: 'report', yaw: 0, pitch: 0, rollDeg: 0, blendshapes: blink(0, 0), now: 3000 }).event).toBe('long-blink');
  });
});

describe('scan state transitions', () => {
  it('collects front samples only in neutral and waits for neutral between sides', () => {
    let state = initialScanState();
    state = applyScanTick(state, { event: 'nod', neutral: true, sideFrameValid: false, now: 0 });
    expect(state.stage).toBe('frontScan');
    for (let i = 0; i < 42; i++) state = applyScanTick(state, { neutral: true, sample: sample(i * 100), sideFrameValid: false, now: 1000 + i * 100 });
    expect(state.stage).toBe('leftScan');
    for (let i = 0; i < 8; i++) state = applyScanTick(state, { neutral: false, sideFrameValid: true, now: 6000 + i * 100 });
    state = applyScanTick(state, { event: 'left-turn', neutral: false, sideFrameValid: false, now: 7000 });
    expect(state.stage).toBe('rightScan');
    for (let i = 0; i < 8; i++) state = applyScanTick(state, { neutral: false, sideFrameValid: true, now: 7100 + i * 100 });
    expect(applyScanTick(state, { event: 'right-turn', neutral: false, sideFrameValid: false, now: 8100 }).stage).toBe('rightScan');
    state = applyScanTick(state, { neutral: true, sideFrameValid: false, now: 8200 });
    for (let i = 0; i < 8; i++) state = applyScanTick(state, { neutral: false, sideFrameValid: true, now: 8300 + i * 100 });
    state = applyScanTick(state, { event: 'right-turn', neutral: false, sideFrameValid: false, now: 9200 });
    state = applyScanTick(state, { neutral: true, sideFrameValid: false, now: 9300 });
    expect(state.stage).toBe('ready');
    state = applyScanTick(state, { event: 'double-blink', neutral: true, sideFrameValid: false, now: 9400 });
    expect(state.stage).toBe('report');
    state = applyScanTick(state, { event: 'long-blink', neutral: true, sideFrameValid: false, now: 9500 });
    expect(state.stage).toBe('calibration');
    expect(state.front).toHaveLength(0);
  });
});

describe('temporal frame quality', () => {
  it('requires six steady landmark frames and rejects visible movement', () => {
    const gate = new TemporalStabilityGate();
    const points = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }));
    points[33] = { x: 0.4, y: 0.35 }; points[263] = { x: 0.6, y: 0.35 };
    points[234] = { x: 0.3, y: 0.5 }; points[454] = { x: 0.7, y: 0.5 };
    expect(Array.from({ length: 5 }, () => gate.update(points, 4 / 3)).every(Boolean)).toBe(false);
    expect(gate.update(points, 4 / 3)).toBe(true);
    points[33] = { x: 0.38, y: 0.35 }; points[263] = { x: 0.58, y: 0.35 };
    expect(gate.update(points, 4 / 3)).toBe(false);
  });
});
