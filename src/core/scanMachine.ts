import { CONFIG } from './config';
import type { FeatureSample, Stage } from './types';

export type ScanMachineState = { stage: Stage; front: FeatureSample[]; leftFrames: number; rightFrames: number; frontStarted: number; neutralStarted: number; leftComplete: boolean; leftReturnedNeutral: boolean; rightComplete: boolean };
export const initialScanState = (): ScanMachineState => ({ stage: 'calibration', front: [], leftFrames: 0, rightFrames: 0, frontStarted: 0, neutralStarted: 0, leftComplete: false, leftReturnedNeutral: false, rightComplete: false });

export function applyScanTick(state: ScanMachineState, input: { event?: 'nod' | 'left-turn' | 'right-turn' | 'double-blink' | 'long-blink'; neutral: boolean; sample?: FeatureSample; sideFrameValid: boolean; now: number }): ScanMachineState {
  const next = { ...state, front: [...state.front] };
  if (state.stage === 'calibration' && input.event === 'nod') { next.stage = 'frontScan'; next.frontStarted = input.now; next.neutralStarted = 0; return next; }
  if (state.stage === 'frontScan') {
    if (input.neutral) {
      if (!next.neutralStarted) next.neutralStarted = input.now;
      if (input.now - next.neutralStarted >= 500 && input.sample && (!next.front.length || input.now - next.front[next.front.length - 1].timestamp >= CONFIG.sampleIntervalMs)) next.front.push(input.sample);
    } else next.neutralStarted = 0;
    if (next.front.length >= CONFIG.targetSamples || (next.front.length >= CONFIG.minSamples && input.now - next.frontStarted >= 5000)) next.stage = 'leftScan';
    return next;
  }
  if (state.stage === 'leftScan') {
    if (input.sideFrameValid) next.leftFrames++;
    if (input.event === 'left-turn' && next.leftFrames >= 8) { next.stage = 'rightScan'; next.leftComplete = true; next.leftReturnedNeutral = false; }
    return next;
  }
  if (state.stage === 'rightScan') {
    if (input.sideFrameValid) next.rightFrames++;
    if (next.leftComplete && !next.leftReturnedNeutral && input.neutral) next.leftReturnedNeutral = true;
    if (next.leftReturnedNeutral && !next.rightComplete && input.event === 'right-turn' && next.rightFrames >= 8) next.rightComplete = true;
    if (next.rightComplete && input.neutral) next.stage = 'ready';
    return next;
  }
  if (state.stage === 'ready' && input.event === 'double-blink') next.stage = 'report';
  if (state.stage === 'report' && input.event === 'long-blink') return initialScanState();
  return next;
}

export const scanInternals = { CONFIG };
