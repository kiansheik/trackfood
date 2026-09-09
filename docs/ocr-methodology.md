# TrackFood nutrition-label OCR methodology

Last reviewed: 2026-09-09

This document records why the scanner is implemented the way it is. Keep the source links here and in the code comments when changing the OCR stack so later work can distinguish a measured design choice from an arbitrary heuristic.

## Product target

For Brazilian packaged foods, the canonical OCR result is nutrition per **100 g for solid/semi-solid foods** or **100 ml for liquids**. Household serving text is useful metadata, but it is not allowed to block completion once the required per-100 nutrition is stable.

This is based on ANVISA RDC 429/2020 art. 8, which requires declarations per 100 g for solids/semi-solids and per 100 ml for liquids, as well as per serving, with listed exceptions:

- https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2020/RDC_429_2020_.pdf
- https://www.gov.br/anvisa/pt-br/assuntos/alimentos/rotulagem/rotulagem-nutricional

IN 75/2020 supplies multiple legal presentation shapes, including vertical, vertical-broken, horizontal-broken, aggregate and linear/run-on layouts. The broken forms can put two separate nutrient groups and two 100 g/100 ml columns on the same visual row. The parser must therefore not assume one rectangular table with one row label per image row.

- https://bvs.saude.gov.br/bvs/saudelegis/anvisa/2020/IN%2075_2020_.pdf
- https://www.gov.br/anvisa/pt-br/assuntos/alimentos/rotulagem/principais-mudancas-e-modelos

## OCR backend decision

### Chosen primary backend: PP-OCRv6_small in the browser

TrackFood uses PaddleOCR's official browser SDK (`@paddleocr/paddleocr-js`) with Portuguese and `ocrVersion: "PP-OCRv6"`. The SDK maps that version to PP-OCRv6_small detection + recognition, returns recognized lines with polygons, and can run the pipeline in a dedicated browser worker.

Sources:

- Official browser SDK: https://www.paddleocr.ai/latest/en/version3.x/inference_deployment/cross_platform/browser.html
- SDK model mapping and worker mode: https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md
- PP-OCRv6 architecture/speed tiers: https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html
- Portuguese support: https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md

Why small rather than tiny initially:

- nutrition labels contain small digits where one wrong character materially changes the food data;
- `small` is still an edge/mobile tier and gives more recognition capacity without the medium model's much higher latency;
- the production metric is full required-field correctness, not generic OCR character accuracy.

TrackFood keeps Tesseract only as a failure fallback. Tesseract output is not mixed into a PP-OCR consensus session.

### Why geometry is preserved

Open Food Facts' `nutrition-extractor` fine-tunes LayoutLMv3 using the image, OCR tokens and their 2D coordinates. Its public evaluation reports about 0.960 F1 and 0.992 token accuracy on its own nutrient-layout dataset. That is strong evidence that flattened OCR text throws away information that matters for nutrition extraction.

- Model card: https://huggingface.co/openfoodfacts/nutrition-extractor
- Training dataset: https://huggingface.co/datasets/openfoodfacts/nutrient-detection-layout

We are **not** shipping that model. The released model is large and CC BY-NC-SA 4.0, which is a poor product dependency if TrackFood ever becomes commercial. We use its methodology as evidence for retaining layout and its public dataset as a future benchmarking/training source subject to its CC BY-SA 3.0 terms.

### Why not PaddleOCR-VL in the browser

PaddleOCR-VL-1.6 is a useful robustness benchmark because Paddle reports strong performance under skew, warping, screen photography and illumination changes. It is still a 0.9B-parameter VLM, much heavier than PP-OCRv6 for an interactive PWA.

- https://www.paddleocr.ai/main/en/version3.x/algorithm/PaddleOCR-VL/PaddleOCR-VL-1.6.html

Use it as a teacher/upper-bound benchmark if we build an offline evaluation harness. Do not make a phone download/run it for ordinary scanning unless future measurements show that device/browser inference has become practical.

## Live capture, tracking and parsing strategy

The current pipeline is:

1. Start the live camera immediately with a large static placement guide.
2. Run a very cheap low-resolution text-density detector to show a tentative area before the OCR model is ready.
3. Once PP-OCR returns polygons, derive the nutrition-specific region from nutrient labels, the nutrition heading and 100 g/100 ml tokens.
4. Track that same region between expensive OCR results on a 96x72 grayscale stream with sparse patch optical flow and a least-squares affine transform.
5. Display the tracked quadrilateral directly over the camera so the person sees what TrackFood believes the label is.
6. Use the OCR-confirmed/tracked region as a generous dynamic crop for later OCR passes. Tentative pre-OCR candidates are visual only and never narrow the OCR crop.
7. Capture a bounded crop about every 450 ms into a maximum three-frame latest-biased queue while OCR is busy.
8. Run only one PP-OCRv6 inference at a time in its worker. Capture/tracking are asynchronous from inference; inference itself remains serial.
9. Preserve line polygons and confidence scores, reconstruct visual rows and locate every visible 100 g/100 ml header position.
10. Match Portuguese nutrient row labels conservatively and associate numeric cells with the relevant per-100 column.
11. Fall back to ordered text parsing for legal linear/run-on layouts.
12. If the literal 100 g/100 ml heading was lost but the linear label retained repeated per-100/per-serving pairs, validate the arithmetic relationship across multiple nutrient fields before recovering the per-100 basis.
13. Never convert 100 ml to 100 g without density data.
14. Run multi-frame field-level consensus; contradictions remain separate candidates.
15. Show field confirmation directly on the camera HUD and allow pause/use-partial at any moment.
16. Stop automatically when the per-100 basis and all required nutrient fields have stable repeated agreement.

### Region tracking methodology

The live region is deliberately not another heavy detector. The goal is to bridge the seconds between PP-OCR results while preserving a visible connection between the object and the algorithm.

- OpenCV's Lucas-Kanade tutorial describes sparse optical flow for following local image features across adjacent frames: https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html
- OpenCV's planar-object homography tutorial documents the detect/match -> transform -> transformed-corners pattern used by document/object trackers: https://docs.opencv.org/4.x/d7/dff/tutorial_feature_homography.html
- Google ML Kit's document scanner describes automatic document detection, accurate edge detection and auto-rotation as core scanner behavior: https://developers.google.com/ml-kit/vision/doc-scanner

TrackFood implements a much smaller browser-specific version: sparse patch matching on 96x72 frames plus an affine transform. Affine motion covers short-interval translation, rotation, scale and shear. PP-OCR periodically re-anchors the region, so the tracker is never trusted indefinitely through occlusion or a major perspective jump. The region tracker is **not nutrition evidence** and cannot confirm a nutrient value.

### Capture quality feedback

Camera quality guidance is a cheap pre-OCR heuristic, not nutritional evidence. A 64x48 sample estimates brightness and edge/focus strength before spending seconds on OCR. Borderline images are still allowed through; only extreme cases are rejected so the heuristic cannot make an unusual package impossible to scan.

Methodology references:

- Google ML Kit text-recognition guidance notes that poor focus hurts recognition and that text should occupy enough pixels while unnecessarily large images increase latency: https://developers.google.com/ml-kit/vision/text-recognition/v2/android
- Pech-Pacheco et al. (ICPR 2000) compares gradient/Laplacian-family autofocus measures for fast focus assessment: https://doi.org/10.1109/ICPR.2000.903548

The UX intentionally avoids flashing. Red/stop means hold still briefly. Solid green means a usable frame was captured or the known label is being followed successfully, so the person can adjust angle/distance. The tracked inner polygon is the primary "this is what I see" signal; the outer static guide is only the initial acquisition area.

## Semantic extraction: why a small LLM is not in the hot path yet

It is technically possible to run a small language model locally in the browser. Transformers.js runs ONNX models through WASM or WebGPU and explicitly supports text generation; quantized models are recommended for constrained browser environments:

- https://huggingface.co/docs/transformers.js/index
- https://huggingface.co/docs/transformers.js/guides/webgpu

For example, `HuggingFaceTB/SmolLM2-135M-Instruct` has a Transformers.js usage path:

- https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct

We are **not adding an LLM to the scanner hot path now** for three reasons:

1. the product needs exact numbers, not plausible language-model completion;
2. adding another model download/inference would worsen the latency problem we are actively reducing;
3. Brazilian nutrition labels have a small regulated vocabulary plus strong units and arithmetic redundancy, which can often recover semantics more reliably than free-form generation.

A concrete example from real testing was OCR text containing `Valor energético 192 kcal (6 kcal, 0%)` with a 3 g serving while the literal `100 g` heading had been missed. The semantic meaning is recoverable deterministically: 192 kcal × 3/100 = 5.76 kcal, which rounds to the printed 6 kcal. Repeating the same relationship across multiple nutrient pairs is much stronger evidence than asking a small LLM whether 192 "probably means calories per 100 g".

Current policy:

- nutrient vocabulary + units (`kcal`, `g`, `mg`) provide semantic typing;
- geometry provides column/row association when available;
- repeated serving arithmetic can rescue a cropped linear 100 g/100 ml heading only when at least two independent fields agree and most readable pairs are consistent;
- an LLM may later be benchmarked as an **unresolved-text candidate generator**, but its output must still pass deterministic unit, basis, geometry and arithmetic checks before it can count as evidence or consensus.

This gives us most of the semantic benefit without another large source of latency or hallucinated values.

## Training data research

We should benchmark before training from scratch.

### Open Food Facts nutrient-layout dataset

About 3,083 professionally annotated nutrition-table images, including metadata flags for USDA-like tables, text-style nutrition layouts and no-table cases. License CC BY-SA 3.0.

- https://huggingface.co/datasets/openfoodfacts/nutrient-detection-layout

### Open Food Facts 20k nutrition-table set

The OFF AI repository documents a French 20k-product set containing original images, nutrition-table crop coordinates, cropped images, Google Vision OCR JSON and user-entered nutrient ground truth. It is useful for table localization and OCR/extraction experiments even though the language mix differs from Brazil.

- https://github.com/openfoodfacts/openfoodfacts-ai/blob/develop/data-sets.md

### Food Packaging OCR Dataset (2026)

A newer field-specific OCR dataset contains food-package text detection/recognition annotations under varied lighting, shooting angles and packaging designs. License CC BY 4.0.

- https://data.mendeley.com/datasets/3cpx2fmn3r/2

### If fine-tuning becomes necessary

Do not train a full OCR stack from zero first. Preferred order:

1. Benchmark PP-OCRv6_tiny vs small on real Brazilian labels.
2. Fine-tune PP-OCR recognition/detection on food-package data if one stage is clearly responsible for errors.
3. Add a constrained numeric recognizer only if digit/decimal errors remain the dominant failure mode.
4. Benchmark a tiny text model only on deterministic-parser failures; do not let it directly confirm values.
5. Build a Brazilian dataset incrementally from user-corrected scans, with explicit consent/privacy handling, rather than collecting unlabeled images blindly.

## Critique cycles

### Cycle 1: shape assumptions

Initial skeleton assumption: a nutrition label behaves like one table whose OCR can be flattened and regexed.

Failure: ANVISA explicitly permits broken and linear forms, and real packages add perspective, paragraphs and fragmented OCR boxes.

Change made: polygons are retained; rows are reconstructed; multiple 100 g columns are supported; linear/run-on text has a separate ordered parser.

Remaining risk: aggregate labels can represent multiple products/preparations. We should refuse automatic save when multiple product columns are detected until a product-selection UI exists.

### Cycle 2: completion criteria and speed

Initial skeleton assumption: serving/household-unit OCR should be required before auto-stop.

Failure: that parenthetical text is often tiny and is not required for TrackFood's canonical per-100 nutrition. It can waste several expensive OCR frames after the useful data is already stable.

Change made: completion now requires canonical per-100 basis + required nutrient fields only. Serving data is retained when recognized but does not block stopping.

Remaining risk: first-use model download can dominate perceived latency. Measure cold/warm startup on representative phones.

### Cycle 3: correctness versus false confidence

Initial temptation: if OCR sees `100 g` anywhere, assume nearby numbers are the 100 g values.

Failure: that can silently mix serving values, %VD and neighboring rows.

Change made: geometry selects the actual per-100 column when available; ambiguous text columns remain unresolved; serving-basis values are standardized explicitly; contradictions can revoke confirmation.

### Cycle 4: model choice

Open Food Facts LayoutLMv3 has excellent task fit but a large/non-commercial finished-model dependency. PaddleOCR-VL is a useful upper-bound benchmark but too heavy for the interactive PWA. Custom Tesseract training would improve characters without solving layout.

Decision: PP-OCRv6_small + geometry-aware Brazilian parser + multi-frame consensus.

### Cycle 5: slow inference versus user control

Observed failure: several-second OCR inference made the scanner feel random, and serial capture wasted the person's ability to supply better angles.

Change made: camera capture continues while OCR is busy; inference remains serial; the queue is bounded to three and latest-biased; partial results can be used at any moment; saved foods can register a barcode so future scans bypass OCR.

### Cycle 6: scanner feedback became stressful

Observed failure: flashing capture borders, multiple colors and abstract progress around the camera made the person feel pressured without showing what the algorithm actually saw.

Change made:

- removed capture flashing and animated progress framing;
- red/stop now has one meaning: hold still briefly;
- green has one meaning: a useful view was captured or the label is confidently tracked;
- the initial large placement guide remains subtle;
- a second quadrilateral shows the actual nutrition region that TrackFood sees;
- sparse optical flow follows that region through movement, rotation, scale and moderate skew between PP-OCR observations;
- PP-OCR polygons re-anchor the tracker;
- the tracked region becomes a generous adaptive crop, improving effective text resolution without requiring the user to manually align a fixed rectangle.

Critique: affine flow is not full projective homography and can drift on severe perspective changes, glossy deformation or occlusion. The safe behavior is to lose the box and reacquire, not continue pretending confidence. Phone testing should tell us whether a small projective/homography tracker is worth the additional computation.

### Cycle 7: semantic OCR text without a readable header

Observed failure: a real linear label retained `Valor energético 192 kcal (6 kcal, 0%)` and several other value/serving pairs, but OCR lost the explicit `100 g` heading. Treating the serving size as the nutrition basis would incorrectly scale 192 kcal per 3 g to 6400 kcal/100 g.

Change made: energy aliases explicitly map `Valor energético`/`Energia` to kcal, and cropped linear labels can recover the missing 100 g/100 ml basis only when repeated per-serving arithmetic validates the interpretation across multiple independent nutrients.

Critique: a tiny browser LLM could understand some corrupted wording, but it adds latency and probabilistic associations exactly where we need exactness. Keep it out of the hot path until benchmark data shows deterministic vocabulary/geometry/arithmetic is the bottleneck. If tested later, use it only to propose candidates that deterministic checks must validate.

## Next empirical gate

Before calling the scanner production-quality, build a labeled benchmark of at least 100 Brazilian package photos spanning:

- clean vertical tables
- vertical/horizontal broken tables
- linear/run-on labels
- glossy curved packages
- perspective/skew
- glare and low light
- small print
- decimal commas and zero values
- both 100 g and 100 ml labels
- cropped/misread 100 g headings where per-serving arithmetic remains visible

For each image, record exact per-100 ground truth. Report:

- per-field exact accuracy
- full-label exact accuracy
- false-confirm rate (most important)
- unresolved/needs-review rate
- cold/warm model startup time
- inference latency per accepted frame
- tracker acquisition/loss/reacquisition rate
- adaptive-crop area and effect on OCR latency/accuracy
- capture queue depth/replacement rate
- time from first acceptable capture to first confirmed field
- time to automatic stop

Only after that benchmark should we decide whether PP-OCRv6 needs fine-tuning, a different capture cadence, a projective tracker, a numeric-specialist model, or a tiny text-model rescue stage.
