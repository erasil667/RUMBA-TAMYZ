import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, ChevronRight, CircleHelp, Eye, Focus, Gauge, LockKeyhole, RotateCcw, ScanFace, ShieldCheck, Sparkles, X } from 'lucide-react';
import { assessFrame, extractFrontFeatures, faceGeometry } from '../core/geometry';
import { CONFIG } from '../core/config';
import { MotionRecognizer } from '../core/motion';
import { applyScanTick, initialScanState } from '../core/scanMachine';
import { calculateAssessment } from '../core/scoring';
import { TemporalStabilityGate } from '../core/stability';
import type { AppError, Assessment, FacePoint, FaceQuality, LandmarkerFrame, Stage } from '../core/types';
import { LandmarkerClient } from '../vision/landmarkerClient';

const stageTitles: Record<Stage, string> = {
  intro: 'Посмотри на себя по-новому', cameraPermission: 'Подключаем камеру', loading: 'Готовим сканер', calibration: 'Поймай нейтраль', frontScan: 'Фронтальный скан', leftScan: 'Левый ракурс', rightScan: 'Правый ракурс', ready: 'Скан готов', report: 'Твой обзор', error: 'Нужна помощь',
};

const cueFor = (stage: Stage, quality: FaceQuality, eventCue?: string) => {
  if (eventCue) return eventCue;
  if (quality === 'no-face') return 'Лицо не найдено. Помести его по центру овала и добавь свет спереди.';
  if (quality === 'multiple-faces') return 'Останься один в кадре — мы сканируем только одно лицо.';
  if (quality === 'out-of-frame') return 'Отойди немного: подбородок и лоб должны помещаться в рамку.';
  if (quality === 'too-small') return 'Подойди немного ближе к камере.';
  if (quality === 'tilted') return 'Держи голову ровнее для стабильного измерения.';
  if (stage === 'calibration') return 'Смотри прямо и держи голову ровно — запоминаю нейтральное положение.';
  if (stage === 'frontScan') return 'Верни голову в нейтраль. Фронтальные кадры соберутся автоматически.';
  if (stage === 'leftScan') return 'Повернись к левому краю экрана и задержись. Затем вернись к центру.';
  if (stage === 'rightScan') return 'После возврата к центру повернись к правому краю экрана.';
  if (stage === 'ready') return 'Дважды моргни, чтобы увидеть обзор.';
  if (stage === 'report') return 'Для повторного сканирования закрой глаза на секунду.';
  return 'Следуй подсказке на экране.';
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<LandmarkerClient | null>(null);
  const unsubscribeWorker = useRef<(() => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const motionRef = useRef(new MotionRecognizer());
  const stabilityRef = useRef(new TemporalStabilityGate());
  const scanRef = useRef(initialScanState());
  const lastFrameSent = useRef(0);
  const lastUiUpdate = useRef(0);
  const frameBusy = useRef(false);
  const loopId = useRef<number | null>(null);
  const videoFrameId = useRef<number | null>(null);
  const pointsRef = useRef<FacePoint[] | null>(null);
  const onWorkerMessageRef = useRef<(message: { type: string; message?: string; faces?: FacePoint[][]; blendshapes?: LandmarkerFrame['blendshapes']; timestamp?: number; inferenceMs?: number }) => void>(() => undefined);
  const [stage, setStage] = useState<Stage>('intro');
  const [error, setError] = useState<AppError | null>(null);
  const [quality, setQuality] = useState<FaceQuality>('no-face');
  const [hint, setHint] = useState('Разреши камеру, чтобы начать локальный анализ.');
  const [progress, setProgress] = useState(0);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [inference, setInference] = useState(0);
  const [count, setCount] = useState({ front: 0, left: 0, right: 0 });
  const [showHow, setShowHow] = useState(false);
  const [scanCounter, setScanCounter] = useState(0);

  const stop = useCallback(() => {
    if (loopId.current !== null) cancelAnimationFrame(loopId.current);
    const video = videoRef.current;
    if (video && 'cancelVideoFrameCallback' in video && videoFrameId.current !== null) video.cancelVideoFrameCallback(videoFrameId.current);
    workerRef.current?.close(); workerRef.current = null;
    unsubscribeWorker.current?.(); unsubscribeWorker.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  const resetScan = useCallback(() => {
    scanRef.current = initialScanState(); motionRef.current.reset(); stabilityRef.current.reset(); pointsRef.current = null;
    setAssessment(null); setCount({ front: 0, left: 0, right: 0 }); setProgress(0); setQuality('no-face'); setStage('calibration');
  }, []);

  const startCamera = useCallback(async () => {
    stop();
    setStage('cameraPermission'); setError(null); setHint('Разреши доступ к камере в системном окне браузера.');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError({ title: 'Камера недоступна', message: 'Открой RUMBA TAMYZ по HTTPS или через localhost в современном браузере.', recoverable: true }); setStage('error'); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setStage('loading'); setHint('Загружаю локальную модель распознавания лица…');
      const client = new LandmarkerClient(); workerRef.current = client;
      unsubscribeWorker.current = client.subscribe(message => {
        if (message.type === 'ready') { setStage('calibration'); setHint('Смотри прямо и держи голову ровно — запоминаю нейтральное положение.'); }
        onWorkerMessageRef.current(message);
      });
      client.init();
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : '';
      const copy = name === 'NotAllowedError' ? ['Доступ к камере запрещён', 'Разреши камеру в настройках браузера и попробуй ещё раз.'] : name === 'NotFoundError' ? ['Камера не найдена', 'Подключи камеру или выбери устройство с камерой.'] : name === 'NotReadableError' ? ['Камера занята', 'Закрой приложение, которое сейчас использует камеру.'] : ['Не удалось запустить камеру', cause instanceof Error ? cause.message : 'Проверь настройки камеры и попробуй ещё раз.'];
      setError({ title: copy[0], message: copy[1], recoverable: true }); setStage('error');
    }
  }, [stop]);

  onWorkerMessageRef.current = message => {
    if (message.type === 'error') {
      stop();
      setError({ title: 'Не удалось запустить распознавание', message: message.message ?? 'Проверь соединение и обнови страницу.', recoverable: true }); setStage('error'); return;
    }
    if (message.type !== 'result' || !message.faces || !message.blendshapes) return;
    frameBusy.current = false;
    const frameNow = message.timestamp ?? performance.now();
    const publishUi = frameNow - lastUiUpdate.current >= CONFIG.uiUpdateMs;
    if (publishUi) { lastUiUpdate.current = frameNow; setInference(Math.round(message.inferenceMs ?? 0)); }
    const dims = videoRef.current;
    if (!dims) return;
    const frameQuality = assessFrame(message.faces);
    if (publishUi) setQuality(frameQuality.quality);
    const face = frameQuality.points;
    const aspect = dims.videoWidth / dims.videoHeight;
    const g = face ? faceGeometry(face, aspect) : null;
    pointsRef.current = frameQuality.quality === 'no-face' || frameQuality.quality === 'multiple-faces' ? null : face ?? null;
    const stableFace = stabilityRef.current.update(face ?? null, aspect);
    const state = scanRef.current;
    const isTilted = frameQuality.quality === 'tilted';
    const motion = g && face && frameQuality.quality === 'good' ? motionRef.current.update({ stage: state.stage, yaw: g.screenYaw, pitch: g.nosePitch, rollDeg: g.rollDeg, blendshapes: message.blendshapes[0] ?? [], now: message.timestamp ?? performance.now() }) : { holdProgress: 0, yaw: 0, neutral: false };
    if (publishUi) {
      if (motion.cue && ['leftScan', 'rightScan'].includes(state.stage) && Math.abs(motion.yaw) > 0.06) setHint(motion.cue);
      else if (frameQuality.quality !== 'good') setHint(cueFor(state.stage, frameQuality.quality));
      else if (!stableFace && state.stage === 'frontScan' && motion.neutral) setHint('Замри на секунду — собираю стабильные фронтальные кадры.');
      else if (!stableFace && ['leftScan', 'rightScan'].includes(state.stage) && Math.abs(motion.yaw) >= CONFIG.turnEnter) setHint('Угол найден. Задержись в этом положении.');
      else setHint(cueFor(state.stage, 'good', motion.cue));
      setProgress(motion.holdProgress || (state.stage === 'frontScan' ? Math.min(1, state.front.length / CONFIG.targetSamples) : state.stage === 'leftScan' ? Math.min(1, state.leftFrames / 8) : state.stage === 'rightScan' ? Math.min(1, state.rightFrames / 8) : motion.holdProgress));
    }

    const frontalSample = !isTilted && stableFace && frameQuality.quality === 'good' && motion.neutral ? extractFrontFeatures(face ?? [], message.timestamp ?? performance.now(), aspect) ?? undefined : undefined;
    const turnSign = state.stage === 'leftScan' ? -1 : 1;
    const sideTurn = g && motion.yaw * turnSign >= CONFIG.turnEnter && motion.yaw * turnSign <= CONFIG.maxMotionYaw;
    const sideFrameValid = stableFace && !!face && frameQuality.quality !== 'no-face' && frameQuality.quality !== 'multiple-faces' && frameQuality.quality !== 'out-of-frame' && frameQuality.quality !== 'too-small' && !!sideTurn && Math.abs(g?.rollDeg ?? 99) < 15;
    const next = applyScanTick(state, { event: frameQuality.quality === 'good' ? motion.event : undefined, neutral: motion.neutral && frameQuality.quality === 'good', sample: frontalSample, sideFrameValid: sideFrameValid && ['leftScan', 'rightScan'].includes(state.stage), now: message.timestamp ?? performance.now() });
    scanRef.current = next;
    if (publishUi || next.stage !== state.stage) setCount({ front: next.front.length, left: next.leftFrames, right: next.rightFrames });
    if (next.stage !== state.stage) {
      if (state.stage === 'report' && next.stage === 'calibration') { motionRef.current.reset(); stabilityRef.current.reset(); }
      setStage(next.stage);
      if (next.stage === 'leftScan') setHint('Фронтальные кадры собраны. Повернись к левому краю экрана.');
      if (next.stage === 'rightScan') setHint('Левый ракурс собран. Вернись к центру, затем повернись вправо.');
      if (next.stage === 'ready') {
        setHint('Боковые ракурсы собраны. Дважды моргни для обзора.');
        setAssessment(calculateAssessment(next.front, next.leftFrames, next.rightFrames));
      }
      if (next.stage === 'calibration' && state.stage === 'report') setHint('Повторный скан. Смотри прямо и держи голову ровно.');
    }
  };

  useEffect(() => {
    if (!['calibration', 'frontScan', 'leftScan', 'rightScan', 'ready', 'report', 'loading'].includes(stage)) return;
    const client = workerRef.current; const video = videoRef.current;
    if (!client || !video) return;
    let cancelled = false;
    const processFrame = async (time: number) => {
      if (cancelled) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !frameBusy.current && time - lastFrameSent.current >= 80) {
        frameBusy.current = true; lastFrameSent.current = time;
        try { await client.sendFrame(video, time); } catch { frameBusy.current = false; }
      }
      if ('requestVideoFrameCallback' in video) videoFrameId.current = video.requestVideoFrameCallback(processFrame);
      else loopId.current = requestAnimationFrame(processFrame);
    };
    if ('requestVideoFrameCallback' in video) videoFrameId.current = video.requestVideoFrameCallback(processFrame);
    else loopId.current = requestAnimationFrame(processFrame);
    return () => { cancelled = true; };
  }, [stage, scanCounter]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    let raf = 0;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (ctx && video.videoWidth && video.videoHeight) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save(); ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
        const pts = pointsRef.current;
        if (pts) {
          ctx.fillStyle = '#8ef1d4';
          for (let i = 0; i < pts.length; i += 7) { ctx.beginPath(); ctx.arc(pts[i].x * canvas.width, pts[i].y * canvas.height, Math.max(1.3, canvas.width / 520), 0, Math.PI * 2); ctx.fill(); }
          ctx.strokeStyle = quality === 'good' ? 'rgba(127, 231, 203, .62)' : 'rgba(255, 193, 122, .72)'; ctx.lineWidth = Math.max(1.1, canvas.width / 800);
          for (const [a,b] of [[10,338],[338,297],[297,332],[332,284],[284,251],[251,389],[389,356],[356,454],[454,323],[323,361],[361,288],[288,397],[397,365],[365,379],[379,152],[152,148],[148,176],[176,149],[149,150],[150,136],[136,172],[172,58],[58,132],[132,93],[93,234],[33,133],[133,159],[159,145],[145,153],[153,154],[154,155],[155,133],[362,263],[263,386],[386,374],[374,380],[380,381],[381,362],[61,291],[61,13],[291,13]] as const) {
            const p = pts[a], q = pts[b]; if (!p || !q) continue; ctx.beginPath(); ctx.moveTo(p.x * canvas.width, p.y * canvas.height); ctx.lineTo(q.x * canvas.width, q.y * canvas.height); ctx.stroke();
          }
        }
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(raf);
  }, [quality]);

  const beginAgain = useCallback(() => { resetScan(); setScanCounter(n => n + 1); }, [resetScan]);
  const screenSteps = useMemo(() => ['Калибровка', 'Фронт', 'Влево', 'Вправо', 'Обзор'], []);
  const stepIndex = stage === 'calibration' ? 0 : stage === 'frontScan' ? 1 : stage === 'leftScan' ? 2 : stage === 'rightScan' ? 3 : ['ready', 'report'].includes(stage) ? 4 : -1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" onClick={e => e.preventDefault()} aria-label="RUMBA TAMYZ"><span className="brand-mark"><ScanFace size={20} strokeWidth={1.8} /></span><span className="brand-text">RUMBA<br />TAMYZ</span></a>
        <div className="privacy-pill"><span className="live-dot" /> LOCAL ANALYSIS <span className="privacy-divider" /> <LockKeyhole size={13} /> PRIVATE BY DESIGN</div>
        <button className="help-button" onClick={() => setShowHow(v => !v)} aria-label="Как это работает"><CircleHelp size={18} /></button>
      </header>

      {showHow && <div className="how-popover"><button className="popover-close" onClick={() => setShowHow(false)} aria-label="Закрыть"><X size={16} /></button><strong>Как работает RUMBA TAMYZ</strong><p>Модель находит ориентиры лица прямо в браузере. Измерения строятся по нескольким стабильным кадрам; фото и видео не отправляются на сервер.</p><p>Оценка условная: она описывает только три выбранных геометрических показателя и зависит от камеры и ракурса.</p></div>}

      <div className="layout" id="top">
        <section className="main-column">
          <div className="eyebrow"><span className="eyebrow-line" /> PERSONAL FACE ANALYSIS <span className="eyebrow-line" /></div>
          <h1>{stageTitles[stage]}</h1>
          <p className="lede">Несколько движений — и честный разбор видимых пропорций лица.</p>

          <div className={`camera-frame ${stage === 'intro' || stage === 'error' ? 'camera-idle' : ''}`}>
            <div className="frame-glow" />
            <video ref={videoRef} className="camera-video" autoPlay muted playsInline aria-label="Превью веб-камеры" />
            <canvas ref={canvasRef} className="face-canvas" aria-hidden="true" />
            {(stage === 'intro' || stage === 'error') && <div className="camera-placeholder"><div className="placeholder-orbit"><ScanFace size={54} strokeWidth={1.15} /></div><span>{stage === 'error' ? 'CAMERA PAUSED' : 'YOUR CAMERA, YOUR DATA'}</span></div>}
            {stage !== 'report' && stage !== 'intro' && stage !== 'error' && <><div className="camera-topline"><span className="camera-live"><i /> LIVE SCAN</span><span className="camera-resolution">LOCAL · {inference ? `${inference} MS` : 'MODEL READY'}</span></div><div className="frame-corner corner-tl" /><div className="frame-corner corner-tr" /><div className="frame-corner corner-bl" /><div className="frame-corner corner-br" /><div className="face-guide"><span /><span /></div></>}
            {stage === 'intro' && <div className="camera-center-badge"><Focus size={17} /> NO PHOTOS SAVED</div>}
            {stage === 'report' && <div className="camera-complete"><Check size={15} /> ANALYSIS COMPLETE</div>}
            {['calibration','frontScan','leftScan','rightScan','ready'].includes(stage) && quality !== 'good' && <div className="camera-inline-hint" role="status" aria-live="polite"><AlertTriangle size={17} /><strong>{hint}</strong></div>}
          </div>

          {stage === 'intro' && <button className="primary-button start-button" onClick={startCamera}><Camera size={18} /> Разрешить камеру и начать <ChevronRight size={18} /></button>}
          {stage === 'error' && <button className="primary-button start-button" onClick={startCamera}><RotateCcw size={17} /> Попробовать снова <ChevronRight size={18} /></button>}
          {stage === 'loading' && <div className="loading-banner"><span className="spinner" /> {hint}</div>}

          {['calibration','frontScan','leftScan','rightScan','ready'].includes(stage) && quality === 'good' && <div className="instruction-card" aria-live="polite">
            <div className="instruction-icon"><Eye size={18} /></div>
            <div className="instruction-copy"><span className="instruction-label">ТВОЁ ДЕЙСТВИЕ</span><strong>{hint}</strong></div>
            <div className="instruction-progress"><span style={{ '--progress': `${Math.round(progress * 100)}%` } as React.CSSProperties} /></div>
          </div>}

          {stage === 'report' && assessment && <Report assessment={assessment} onRepeat={beginAgain} />}
          {stage === 'report' && !assessment && <div className="report-empty"><strong>Недостаточно данных для надёжного обзора</strong><p>Нужно не меньше 18 стабильных фронтальных кадров. Повтори скан, следуя подсказкам.</p><button className="secondary-button" onClick={beginAgain}><RotateCcw size={16} /> Повторить скан</button></div>}
          {stage === 'error' && error && <div className="error-card"><AlertTriangle size={19} /><div><strong>{error.title}</strong><p>{error.message}</p></div></div>}
        </section>

        <aside className="side-column">
          {stage === 'report' && assessment ? <ScorePanel assessment={assessment} /> : <>
            <div className="panel scan-panel"><div className="panel-heading"><span className="panel-icon"><Gauge size={17} /></span><span>ПРОГРЕСС СКАНА</span><b>{stepIndex >= 0 ? `${stepIndex + 1} / 5` : '—'}</b></div><div className="step-list">{screenSteps.map((item, index) => <div key={item} className={`step-row ${index < stepIndex ? 'done' : index === stepIndex ? 'active' : ''}`}><span className="step-check">{index < stepIndex ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span><span>{item}</span><i /></div>)}</div><div className="scan-footnote"><span className="live-dot" /> {quality === 'good' ? `Лицо в кадре · ${count.front} фронт. кадров` : quality === 'no-face' ? 'Ищу лицо…' : quality === 'multiple-faces' ? 'Найдено несколько лиц' : 'Настрой кадр'}</div></div>
            <div className="panel signal-panel"><div className="panel-heading"><span className="panel-icon"><Sparkles size={16} /></span><span>ЧТО МЫ ИЗМЕРЯЕМ</span></div><div className="metric-preview"><div className="metric-preview-icon">◌</div><div><strong>Визуальная симметрия</strong><span>Пары ориентиров относительно центра</span></div></div><div className="metric-preview"><div className="metric-preview-icon">⌁</div><div><strong>Пропорции лица</strong><span>Ширина к видимой высоте</span></div></div><div className="metric-preview"><div className="metric-preview-icon">◎</div><div><strong>Интервал глаз</strong><span>Между внутренними и внешними уголками</span></div></div><div className="panel-footnote">Без распознавания личности и медицинских выводов.</div></div>
            <div className="privacy-note"><ShieldCheck size={16} /><span>Обработка идёт в браузере.<br /><strong>Кадры остаются на устройстве.</strong></span></div>
          </>}
        </aside>
      </div>

      <footer className="footer"><span>RUMBA TAMYZ © 2026</span><span>УСЛОВНЫЙ ИНДЕКС, НЕ ПРОЦЕНТ КРАСОТЫ</span><span>БЕЗ МЕДИЦИНСКИХ ВЫВОДОВ</span></footer>
      {stage === 'report' && <p className="disclaimer">Условная оценка алгоритма; результат зависит от камеры и ракурса.</p>}
    </main>
  );
}

function ScorePanel({ assessment }: { assessment: Assessment }) {
  return <div className="panel score-panel"><div className="panel-heading"><span className="panel-icon"><Gauge size={17} /></span><span>УСЛОВНЫЙ ИНДЕКС</span></div><div className="score-orb"><div className="score-ring" style={{ '--score': `${assessment.overall ?? 0}%` } as React.CSSProperties}><span>{assessment.overall ?? '—'}</span><small>/ 100</small></div></div><p className="score-caption">{assessment.overall === null ? 'Недостаточно данных' : 'Визуальные характеристики'}</p><div className="confidence-row"><span>КАЧЕСТВО СКАНА</span><b>{assessment.confidenceLabel}</b></div><div className="confidence-track"><i style={{ width: `${assessment.confidence}%` }} /></div><p className="confidence-sub">{assessment.sampleCount} стабильных фронтальных кадров</p><div className="formula-footnote">Баллы рассчитаны по открытым диапазонам продукта, а не по универсальному эталону.</div></div>;
}

function Report({ assessment, onRepeat }: { assessment: Assessment; onRepeat: () => void }) {
  return <section className="report-content">
    <div className="report-title-row"><div><span className="section-kicker">ТВОЙ РЕЗУЛЬТАТ</span><h2>Обзор пропорций</h2></div><span className="report-badge"><Check size={13} /> ГОТОВО</span></div>
    <p className="report-intro">Это разбор нескольких измеримых ориентиров в текущем скане. Он не описывает твою ценность или личность.</p>
    <div className="report-quality"><ShieldCheck size={17} /><div><strong>{assessment.confidenceLabel}</strong><span>Качество измерений отдельно от балла</span></div><div className="mini-progress"><i style={{ width: `${assessment.confidence}%` }} /></div></div>
    <div className="metrics-grid">{assessment.metrics.map(metric => <article className="metric-card" key={metric.id}><div className="metric-card-top"><span>{metric.title}</span><b>{metric.score}<small>/100</small></b></div><div className="metric-bar"><i style={{ width: `${metric.score}%` }} /></div><div className="raw-value">ИЗМЕРЕНИЕ <b>{metric.displayValue}</b></div><p>{metric.description}</p></article>)}</div>
    {!assessment.metrics.length && <div className="report-empty inline"><strong>Недостаточно данных для оценки</strong><p>Фронтальные измерения не прошли проверку устойчивости.</p></div>}
    <div className="report-bottom-grid"><article className="report-block"><span className="section-kicker">СИЛЬНЫЕ СТОРОНЫ</span>{assessment.strengths.length ? <ul>{assessment.strengths.map(s => <li key={s}><Check size={14} /> {s}</li>)}</ul> : <p>Для сильных сторон недостаточно надёжных измерений.</p>}</article><article className="report-block"><span className="section-kicker">МОЖНО ПОПРОБОВАТЬ</span><ul>{assessment.recommendations.map(s => <li key={s}><Sparkles size={13} /> {s}</li>)}</ul></article></div>
    <div className="side-notes"><strong>О боковых ракурсах</strong>{assessment.sideNotes.map(note => <p key={note}>{note}</p>)}</div>
    <div className="score-limit"><AlertTriangle size={15} /><span>Объективного «процента красоты» не существует. Камера не является 3D-сканером, а диапазоны показателей — условные настройки продукта.</span></div>
    <button className="secondary-button repeat-button" onClick={onRepeat}><RotateCcw size={16} /> Повторить скан <span>или закрой глаза на секунду</span></button>
  </section>;
}
