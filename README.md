# RUMBA TAMYZ

## 🚀 Деплой / Live demo

### [▶ Открыть RUMBA TAMYZ — работающий проект](https://rumba-tamyz.dimadde39.chatgpt.site/)

**Проект опубликован и доступен по публичной HTTPS-ссылке.** Для запуска ничего устанавливать не нужно: откройте ссылку в браузере и разрешите доступ к камере. Production-сборка, модель Face Landmarker и WASM размещены на хостинге Sites. Инструкция локального запуска и результаты проверки находятся ниже.

RUMBA TAMYZ is a browser based face proportion demo for the ADMIT “MOTION: camera instead of a joystick” hackathon. It scans a face using the local webcam, lets the user move through the scan with head gestures, and reports a reproducible product index for three visible geometric measurements.

## Live application

[Open RUMBA TAMYZ](https://rumba-tamyz.dimadde39.chatgpt.site/). The production application is served over HTTPS by Sites; the model and WASM files are served from the same origin.

## Run locally

Requirements: Node.js 20.19+ (or 22.12+) and pnpm 9+.

```sh
pnpm install --frozen-lockfile
pnpm prepare:vision-assets
pnpm dev
```

Open the local Vite URL. Camera access is available on `localhost` during development. A hosted build must use HTTPS.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

Deploy the contents of `dist/` to any static HTTPS host. Vite uses a relative base path; the model and WASM resources are resolved against the application URL so a deployment below a path prefix works too.

## Scan and gestures

1. Allow camera access. Keep one face inside the guide until the neutral pose is learned.
2. Nod down and return to neutral to start scanning.
3. Hold a neutral, front facing pose while 18–36 valid samples are gathered.
4. Turn toward the **left edge of the screen**, hold the angle, then return to centre.
5. Turn toward the **right edge of the screen**, hold the angle, then return to centre.
6. Double blink to open the report. In the report, keep both eyes closed for about one second to scan again.

Camera preview and landmarks are horizontally mirrored. Internally, the horizontal turn estimate is sign corrected so on screen directions match the prompt. Head angle thresholds are product tuning values and require hands on verification across webcams.

The recognizer smooths pose values, requires an approximately 1.05 second sustained turn beyond the 0.16 normalized yaw threshold (and below 0.39), uses a neutral return between stages, latches accepted movements, and applies a cooldown. Blink events require both eye blink blendshape scores above 0.62 and a timed sequence; each blink must last 70–380 ms and the second must begin within 1.5 seconds. The report restart gesture is an 850 ms bilateral eye closure. A six-frame temporal gate rejects front or side samples while landmark centre drift exceeds 2.5% of face width or face width changes over 4.5%. The normal motion loop never drives React at video frame rate.

## Measurements and score

The selected MediaPipe Face Landmarker outputs 478 normalized landmarks, optional blendshapes, and an optional transformation matrix. RUMBA TAMYZ uses the official result arrays `faceLandmarks`, `faceBlendshapes`, and `facialTransformationMatrixes`; it does not read a per-face `confidence` field because that field is not part of this result type. `numFaces` is set to 2 so the UI can detect and explain a multiple-face frame. Since model smoothing is disabled for multi-face mode, the app smooths pose values itself.

Each candidate frame must contain the expected landmarks, have the face inside the safe frame, and pass the relevant pose filter. Front measurements require neutral yaw, roll below 8°, and at least 18 stable samples. Side scans count valid frames only while the expected turn is held. The frontal filter is not applied to side frames.

Only three numeric features are used:

| Metric | Landmarks and formula | Product score rule | Weight |
| --- | --- | --- | ---: |
| Visible symmetry | For pairs (33,263), (133,362), (105,334), (61,291), (98,327), (172,397), average `hypot((abs(xL-midEyeX)-abs(xR-midEyeX)) × aspect, yL-yR) / faceWidth`. `midEyeX` is the midpoint of landmarks 33 and 263; face width uses horizontal distance (234,454) scaled to frame height. | `round(100 × max(0, 1 − medianError / 0.045))` | 40% |
| Face width / height | Pixel-space distance(234,454) / pixel-space distance(10,152), using the actual video aspect ratio | 100 inside [0.66, 0.86]; linearly declines to 0 at [0.50, 1.02] | 35% |
| Eye spacing | Pixel-space distance(133,362) / pixel-space distance(33,263), using the actual video aspect ratio | 100 inside [0.30, 0.50]; linearly declines to 0 at [0.16, 0.68] | 25% |

The ranges and weights are explicit product settings, not scientifically validated attractiveness norms. Each feature uses the median over valid frames. Overall is the weighted mean of the three scores, rounded to an integer. With fewer than 18 valid frontal samples, the overall score is “insufficient data.” No missing feature is assigned zero or fabricated. A future unavailable component would be removed from both weighted sum and denominator, and its absence described.

Side views are used only to confirm the required movement and show scan coverage. They do not create a jawline score: a standard webcam does not provide a dependable 3D jaw measurement. Scan quality is reported separately from the face score.

## Error prompts

The app shows one primary instruction at a time. It detects no face, multiple faces, a face box near the frame edge, a too small face, excessive roll, the opposite turn, an insufficient angle, an angle beyond the configured maximum, and a held angle that has not lasted long enough. Side capture continues to accept a tilted-neutral rejection only when the side head angle is intentional and the face remains within the frame.

Camera API failures are separate: permission denied, camera missing, camera busy, insecure context, model or WASM load failure. An error remains recoverable by retrying the camera or refreshing the page.

## Libraries and privacy

- React, TypeScript, Vite
- `@mediapipe/tasks-vision` Face Landmarker
- `lucide-react` icons
- Vitest for deterministic logic tests

Frames go from the video element to a local Web Worker using transferable `ImageBitmap` objects. The worker loads the model and WASM from the same deployment origin. The app has no backend, accounts, analytics, external model API, photo upload, video upload, saved history, or generative AI. Camera permission is requested only after the user presses the start button. Closing/reloading the page stops the media tracks.

## Limitations and interpretation

There is no objective “beauty percentage.” The displayed 0–100 is a conditional index of the selected visual geometry and depends on camera, lighting, distance, lens, expression, and angle. It is not a medical diagnosis or a measure of character, intelligence, origin, identity, or worth. The model landmarks estimate a 2D face surface; the webcam and model are not a calibrated 3D scanner. The hairline is not scored. Appearance tips are optional styling ideas, not corrections a person needs.

## Hackathon twist

The camera replaces the joystick: a nod starts the scan, sustained left and right turns collect separate angle frames, and blinks navigate the result. The “error mode” makes movement itself part of the interaction: a turn in the wrong direction, a turn that is too small or too large, or a pose released too early gets an immediate concrete correction such as “turn a little further toward the left edge of the screen” or “hold this position a little longer.” Camera and framing problems get separate prompts, and fixing them resumes the current step.

## Deployment

The first production deployment uses Sites. Its project identity and static output directory are recorded in `.openai/hosting.json`. Build with the commands above and publish the complete `dist/` directory, including `models/face_landmarker.task` and `wasm/vision_wasm_module_internal.{js,wasm}`. Do not deploy the source directory or omit these assets.

The repository also contains `.github/workflows/pages.yml` for GitHub Pages. Pages is currently disabled in the repository, so that workflow cannot publish yet. A repository administrator must select **Settings → Pages → Build and deployment → Source: GitHub Actions** before using it. The configured contributor has write access but cannot enable Pages. Once enabled, pushes to `main` install dependencies, prepare local assets, run checks, build, and deploy `dist/`.

The generated model and WASM binaries are ignored by Git. Run `pnpm prepare:vision-assets` after installation in a clean checkout. No application logic was changed for this deployment.

## Manual webcam check

Use a real webcam in an HTTPS deployment (or localhost) and check: permission grant/deny, no camera, camera busy, one/two faces, frame edges, head roll, nod down-and-return, left/right sign in the mirrored preview, short/long turn holds, natural single blink, double blink, long blink, and restart gesture. Synthetic motion tests validate rule sequences only; they do not prove camera landmark or direction accuracy. No commit history is fabricated; this workspace was not initialized as a Git repository when implementation began.

## First deployment verification

- TypeScript checks, all 10 deterministic tests, and the production Vite build passed.
- The public HTTPS page loads in Chromium with a secure context.
- The face model (3,758,596 bytes), module loader (323,415 bytes), and WASM (11,756,972 bytes) return HTTP 200. Model and WASM SHA-256 hashes match the local production build; WASM is served as `application/wasm`.
- The deployed module Worker initializes MediaPipe and successfully processes a blank test frame, returning an empty face list as expected.
- A real Integrated Camera was available: the application received a live 640×480 stream and reached calibration. Camera permission denial and retry were also checked. A complete scan with a person, head gestures, and blink navigation remains a manual check; no claim of full gesture validation is made.


