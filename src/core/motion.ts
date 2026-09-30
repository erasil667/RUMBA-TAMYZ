import { CONFIG } from './config';
import type { Blendshape, MotionEvent, Stage } from './types';

type MotionInput = {
  stage: Stage;
  yaw: number;
  pitch: number;
  rollDeg: number;
  blendshapes: Blendshape[];
  now: number;
};
type MotionOutput = { event?: MotionEvent; cue?: string; holdProgress: number; yaw: number; neutral: boolean };

export class MotionRecognizer {
  private baselineYaw = 0;
  private baselinePitch = 0;
  private calibrated = false;
  private neutralSamples: { yaw: number; pitch: number }[] = [];
  private nodStarted = 0;
  private nodLatched = false;
  private turnStarted = 0;
  private turnDirection = 0;
  private turnLatched = false;
  private turnEmitted = false;
  private eyeClosedStarted = 0;
  private firstBlinkAt = 0;
  private blinkLatched = false;
  private lastGestureAt = 0;
  private smoothedYaw = 0;
  private smoothedPitch = 0;

  update(input: MotionInput): MotionOutput {
    const alpha = 0.28;
    this.smoothedYaw = this.smoothedYaw * (1 - alpha) + input.yaw * alpha;
    this.smoothedPitch = this.smoothedPitch * (1 - alpha) + input.pitch * alpha;
    const yaw = this.smoothedYaw - this.baselineYaw;
    const pitch = this.smoothedPitch - this.baselinePitch;
    const neutral = Math.abs(yaw) < CONFIG.returnNeutral && Math.abs(pitch) < 0.045 && Math.abs(input.rollDeg) < CONFIG.frontRollDeg;

    if (input.stage === 'calibration' && !this.calibrated) {
      if (Math.abs(yaw) < 0.12 && Math.abs(input.rollDeg) < CONFIG.neutralRollDeg) {
        this.neutralSamples.push({ yaw: this.smoothedYaw, pitch: this.smoothedPitch });
        if (this.neutralSamples.length > CONFIG.neutralFrames) this.neutralSamples.shift();
      }
      if (this.neutralSamples.length >= CONFIG.neutralFrames) {
        this.baselineYaw = this.neutralSamples.reduce((a, v) => a + v.yaw, 0) / this.neutralSamples.length;
        this.baselinePitch = this.neutralSamples.reduce((a, v) => a + v.pitch, 0) / this.neutralSamples.length;
        this.calibrated = true;
      }
      return { cue: this.calibrated ? 'Нейтраль запомнена. Теперь слегка опусти подбородок, затем вернись прямо.' : 'Держи голову прямо и не двигайся — запоминаю нейтраль.', holdProgress: Math.min(1, this.neutralSamples.length / CONFIG.neutralFrames), yaw, neutral };
    }

    if (input.stage === 'calibration' && (this.lastGestureAt === 0 || input.now - this.lastGestureAt > CONFIG.gestureCooldownMs)) {
      if (this.nodLatched) {
        if (Math.abs(pitch) < CONFIG.nodUp) {
          this.lastGestureAt = input.now;
          this.nodStarted = 0;
          this.nodLatched = false;
          return { event: 'nod', cue: 'Кивок принят. Сканирую фронтальный ракурс.', holdProgress: 1, yaw, neutral };
        }
        return { cue: 'Кивок пойман — теперь верни голову прямо.', holdProgress: 0.9, yaw, neutral };
      }
      if (pitch > CONFIG.nodDown) {
        if (!this.nodStarted) this.nodStarted = input.now;
        const nodProgress = Math.min(1, (input.now - this.nodStarted) / CONFIG.nodHoldMs);
        if (nodProgress >= 1) this.nodLatched = true;
        return { cue: this.nodLatched ? 'Кивок пойман — теперь верни голову прямо.' : 'Хорошо. Опусти подбородок чуть-чуть и верни голову прямо.', holdProgress: this.nodLatched ? 0.9 : 0.35 + nodProgress * 0.5, yaw, neutral };
      }
      this.nodStarted = 0;
      if (pitch < -CONFIG.nodDown * 0.55) return { cue: 'Не запрокидывай голову — слегка опусти подбородок вниз.', holdProgress: 0, yaw, neutral };
      return { cue: 'Нейтраль запомнена. Теперь слегка опусти подбородок, затем вернись прямо.', holdProgress: 0, yaw, neutral };
    }

    if (input.stage === 'leftScan' || input.stage === 'rightScan') {
      const expected = input.stage === 'leftScan' ? -1 : 1;
      const directed = yaw * expected;
      if (Math.abs(yaw) > 0.07 && directed < -0.07) return { cue: `Поворот в другую сторону — поверни к ${input.stage === 'leftScan' ? 'левому' : 'правому'} краю экрана.`, holdProgress: 0, yaw, neutral };
      if (directed > CONFIG.maxMotionYaw) return { cue: 'Поворот слишком сильный. Немного верни голову к центру.', holdProgress: 0, yaw, neutral };
      if (directed >= CONFIG.turnEnter) {
        if (!this.turnStarted || this.turnDirection !== expected) { this.turnStarted = input.now; this.turnDirection = expected; }
        this.turnLatched = true;
        const holdProgress = Math.min(1, (input.now - this.turnStarted) / CONFIG.turnHoldMs);
        if (!this.turnEmitted && holdProgress >= 1 && input.now - this.lastGestureAt >= CONFIG.turnCooldownMs) {
          this.turnEmitted = true; this.lastGestureAt = input.now;
          return { event: expected < 0 ? 'left-turn' : 'right-turn', cue: 'Поворот принят. Вернись к центру.', holdProgress, yaw, neutral };
        }
        return { cue: holdProgress < 1 ? 'Хорошо. Задержись в этом положении.' : undefined, holdProgress, yaw, neutral };
      }
      if (this.turnLatched && input.now - this.turnStarted >= 450 && directed > 0.08) {
        return { cue: 'Положение распознано, но его нужно удержать ещё немного.', holdProgress: Math.min(0.95, (input.now - this.turnStarted) / CONFIG.turnHoldMs), yaw, neutral };
      }
      this.turnStarted = 0; this.turnLatched = false; this.turnDirection = 0; this.turnEmitted = false;
      if (directed > 0.045) return { cue: `Поверни чуть дальше к ${input.stage === 'leftScan' ? 'левому' : 'правому'} краю экрана.`, holdProgress: 0, yaw, neutral };
    }

    const blinkLeft = input.blendshapes.find(s => s.categoryName === 'eyeBlinkLeft')?.score ?? 0;
    const blinkRight = input.blendshapes.find(s => s.categoryName === 'eyeBlinkRight')?.score ?? 0;
    const bothClosed = blinkLeft >= CONFIG.blinkClosed && blinkRight >= CONFIG.blinkClosed;
    const bothOpen = blinkLeft < CONFIG.blinkOpen && blinkRight < CONFIG.blinkOpen;
    if (input.stage === 'ready' || input.stage === 'report') {
      if (bothClosed && !this.blinkLatched) {
        this.blinkLatched = true; this.eyeClosedStarted = input.now;
      }
      if (this.blinkLatched && bothOpen) {
        const duration = input.now - this.eyeClosedStarted;
        this.blinkLatched = false;
        if (input.stage === 'report' && duration >= CONFIG.longBlinkMs) {
          this.lastGestureAt = input.now; this.firstBlinkAt = 0;
          return { event: 'long-blink', cue: 'Повторный скан запускается.', holdProgress: 1, yaw, neutral };
        }
        if (duration >= CONFIG.blinkMinMs && duration <= CONFIG.blinkMaxMs) {
          if (this.firstBlinkAt && input.now - this.firstBlinkAt <= CONFIG.doubleBlinkWindowMs && input.now - this.lastGestureAt >= CONFIG.gestureCooldownMs) {
            this.firstBlinkAt = 0; this.lastGestureAt = input.now;
            return { event: 'double-blink', cue: 'Готово. Открываю обзор.', holdProgress: 1, yaw, neutral };
          }
          this.firstBlinkAt = input.now;
        }
      }
      if (this.firstBlinkAt && input.now - this.firstBlinkAt > CONFIG.doubleBlinkWindowMs) this.firstBlinkAt = 0;
    }
    return { holdProgress: 0, yaw, neutral };
  }

  reset() {
    this.baselineYaw = 0; this.baselinePitch = 0; this.calibrated = false; this.neutralSamples = [];
    this.nodStarted = 0; this.nodLatched = false; this.turnStarted = 0; this.turnDirection = 0; this.turnLatched = false; this.turnEmitted = false;
    this.eyeClosedStarted = 0; this.firstBlinkAt = 0; this.blinkLatched = false; this.lastGestureAt = 0;
    this.smoothedYaw = 0; this.smoothedPitch = 0;
  }
}
