/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

type RequestMessage = { type: 'init'; modelUrl: string; wasmUrl: string } | { type: 'frame'; bitmap: ImageBitmap; timestamp: number } | { type: 'close' };
const scope = self as DedicatedWorkerGlobalScope;
let landmarker: FaceLandmarker | undefined;

scope.onmessage = async (event: MessageEvent<RequestMessage>) => {
  try {
    const message = event.data;
    if (message.type === 'init') {
      // This worker is an ES module; MediaPipe's module loader exposes ModuleFactory correctly here.
      const files = await FilesetResolver.forVisionTasks(message.wasmUrl, true);
      const options = {
        runningMode: 'VIDEO',
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      } as const;
      try {
        landmarker = await FaceLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: message.modelUrl, delegate: 'GPU' } });
      } catch {
        landmarker = await FaceLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: message.modelUrl, delegate: 'CPU' } });
      }
      scope.postMessage({ type: 'ready' });
    } else if (message.type === 'frame' && landmarker) {
      const started = performance.now();
      try {
        const result = landmarker.detectForVideo(message.bitmap, message.timestamp);
        scope.postMessage({ type: 'result', faces: result.faceLandmarks, blendshapes: result.faceBlendshapes.map(x => x.categories), timestamp: message.timestamp, inferenceMs: performance.now() - started });
      } finally {
        message.bitmap.close();
      }
    } else if (message.type === 'close') {
      landmarker?.close(); landmarker = undefined; scope.close();
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
