import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('@mediapipe/tasks-vision'));
const wasmSource = join(packageRoot, 'wasm');
const wasmTarget = join(process.cwd(), 'public', 'wasm');
const modelTarget = join(process.cwd(), 'public', 'models', 'face_landmarker.task');
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

await mkdir(wasmTarget, { recursive: true });
await mkdir(dirname(modelTarget), { recursive: true });
for (const file of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
  await copyFile(join(wasmSource, file), join(wasmTarget, file));
}

try {
  const existing = await stat(modelTarget);
  if (existing.size > 1_000_000) {
    console.log('Face Landmarker model already present.');
    process.exit(0);
  }
} catch {
  // Download the official model on first setup or in a clean CI checkout.
}

const response = await fetch(modelUrl);
if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
const model = Buffer.from(await response.arrayBuffer());
if (model.byteLength < 1_000_000) throw new Error('Downloaded face model is unexpectedly small.');
await writeFile(modelTarget, model);
console.log(`Prepared local Face Landmarker assets (${model.byteLength.toLocaleString()} model bytes).`);
