# TrackFood native OCR and first-use loading

## Goal

The browser PP-OCRv6 fallback works, but its first initialization can be slow enough to dominate the scanner experience. The preferred phone path is now:

1. Capacitor native build -> Google ML Kit text recognition.
2. Normal PWA/browser -> use `TextDetector` when the browser exposes the Shape Detection text API.
3. Otherwise -> PP-OCRv6-small in a worker.
4. Tesseract remains a compatibility fallback if PP-OCR cannot initialize.

All providers normalize their output to TrackFood's existing `OcrLayout` contract (`text`, polygon, score proxy). The Brazilian label parser, semantic nutrition region, per-100 normalization, plausibility constraints, and multi-photo consensus therefore remain provider-independent.

## Native provider

`src/services/nativeLabelReader.ts` implements the fast provider layer.

For a Capacitor build it uses `@pantrist/capacitor-plugin-ml-kit-text-recognition`, which accepts a base64 image and exposes blocks/lines plus bounding boxes/corner points on Android and iOS. TrackFood converts ML Kit lines into `OcrLayout` rows. This first revision intentionally uses ML Kit on both native platforms. A dedicated Apple Vision provider can be substituted for iOS later without changing the parser contract.

References:

- Google ML Kit Text Recognition v2: https://developers.google.com/ml-kit/vision/text-recognition/v2/android
- Capacitor ML Kit wrapper: https://github.com/Pantrist-dev/capacitor-plugin-ml-kit-text-recognition
- Capacitor: https://capacitorjs.com/docs

For a browser/PWA install, TrackFood checks the Shape Detection API `TextDetector` before loading Paddle. The WICG API returns `rawValue`, `boundingBox`, and `cornerPoints`, which is exactly the kind of spatial OCR output the current parser needs. It is opportunistic only because browser availability is still inconsistent.

- Shape Detection Text API: https://wicg.github.io/shape-detection-api/text.html

## Capacitor setup

The repository now contains `capacitor.config.ts` and scripts, but does not commit generated Android/iOS IDE projects yet.

```bash
npm install
npm run build
npm run cap:add:android
npm run cap:add:ios
npm run cap:sync
```

After a platform exists:

```bash
npm run native:android
# or
npm run native:ios
```

`cap sync` installs the native ML Kit plugin into the platform project.

## Browser OCR startup progress

PaddleOCR.js worker mode explicitly rejects a custom `fetch` implementation. That means TrackFood cannot truthfully expose byte-level download progress while preserving the worker architecture. Instead, `src/services/paddleLabelReader.ts` reports an **estimated** startup percentage/ETA:

- first run uses the browser's reported downlink when available plus a runtime initialization allowance;
- otherwise it starts with a conservative 45-second estimate;
- after a successful load, TrackFood stores an exponentially weighted startup duration for that device;
- subsequent ETAs therefore adapt to the actual phone/browser;
- progress is capped below 100 until Paddle really resolves.

The app shell listens for `trackfood:ocr-startup` and renders a persistent progress bar with the current provider and ETA. Native OCR normally reaches ready without the large Paddle model stage.

Paddle worker/custom-fetch limitation:

- https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/src/pipelines/ocr/index.ts

## Model/runtime caching

The service worker keeps two separate OCR caches:

- `trackfood-ocr-models-v1`: the two PP-OCRv6-small model archives, kept up to 180 days;
- `trackfood-ocr-runtime-v1`: lazy JS/WASM/OpenCV/ORT runtime pieces.

The model archives remain lazy; ordinary TrackFood users do not download them unless the browser fallback is actually needed.

## Force update on installed PWAs

Phone-installed PWAs can occasionally remain controlled by an older service worker even after a deployment is visible in incognito. Settings now has **Force update & reload**.

`src/services/appRefresh.ts`:

1. unregisters only the service worker whose scope exactly matches TrackFood's `BASE_URL`;
2. clears the disposable TrackFood OCR runtime cache;
3. deliberately keeps IndexedDB and the large OCR model cache;
4. fetches a cache-busted `index.html` with `cache: no-store`;
5. reloads the current route with a one-time cache-busting query parameter;
6. `src/main.ts` removes that query parameter after the fresh shell boots.

This is deliberately more aggressive than the normal "Update ready" prompt, but it does not erase foods, logs, settings, barcodes, or weight history.

## Validation still needed

The important next measurements are real-device measurements, not synthetic confidence claims:

- whether the user's Android Chrome exposes `TextDetector` to an installed PWA;
- one-photo exact nutrition accuracy of ML Kit versus PP-OCRv6 on the same Brazilian labels;
- native OCR latency on representative Android/iPhone hardware;
- percentage of native one-photo scans that are good enough to hand directly to review;
- PP-OCR cold-start ETA calibration error on slow and fast networks;
- confirmation that `trackfood-ocr-models-v1` eliminates model network transfer on later browser scans.
