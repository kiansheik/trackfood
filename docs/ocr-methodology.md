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

TrackFood uses PaddleOCR's official browser SDK (`@paddleocr/paddleocr-js`) with Portuguese and `ocrVersion: "PP-OCRv6"`. The SDK maps that version to PP-OCRv6_small detection + recognition, returns recognized lines with polygons, and can run the entire pipeline in a dedicated browser worker.

Sources:

- Official browser SDK: https://www.paddleocr.ai/latest/en/version3.x/inference_deployment/cross_platform/browser.html
- SDK model mapping and worker mode: https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md
- PP-OCRv6 architecture/speed tiers: https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html
- Portuguese support for PP-OCRv6: https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md

Why small rather than tiny initially:

- `tiny` is attractive for latency, but nutrition labels contain small digits where one character changes the food data materially.
- `small` is still an edge/mobile tier and gives us more recognition capacity without the medium model's much higher latency.
- The production metric is not generic OCR character accuracy. It is the percentage of labels whose entire required per-100 nutrient vector is correct.

TrackFood keeps Tesseract only as a failure fallback. Tesseract output is not mixed into a PP-OCR consensus session.

### Why geometry is preserved

Open Food Facts' `nutrition-extractor` fine-tunes LayoutLMv3 using the image, OCR tokens and their 2D coordinates. Its public evaluation reports about 0.960 F1 and 0.992 token accuracy on its own nutrient-layout dataset. That is strong evidence that flattened OCR text throws away information that matters for nutrition extraction.

- Model card: https://huggingface.co/openfoodfacts/nutrition-extractor
- Training dataset: https://huggingface.co/datasets/openfoodfacts/nutrient-detection-layout

We are **not** shipping that model. The released model is large and CC BY-NC-SA 4.0, which is a poor product dependency if TrackFood ever becomes commercial. We use its methodology as evidence for retaining layout and its public dataset as a future benchmarking/training source subject to its CC BY-SA 3.0 terms.

### Why not PaddleOCR-VL in the browser

PaddleOCR-VL-1.6 is a useful accuracy/robustness benchmark because Paddle reports strong performance under skew, warping, screen photography and illumination changes. It is still a 0.9B-parameter VLM, much heavier than PP-OCRv6 for an interactive PWA.

- https://www.paddleocr.ai/main/en/version3.x/algorithm/PaddleOCR-VL/PaddleOCR-VL-1.6.html

Use it as a teacher/upper-bound benchmark if we build an offline evaluation harness. Do not make a phone download/run it for ordinary scanning unless future measurements show that device/browser inference has become practical.

## Parsing strategy

The current pipeline is:

1. Capture a bounded camera crop.
2. Run PP-OCRv6 detection + recognition in a worker.
3. Keep line polygons and confidence scores.
4. Reconstruct visual rows.
5. Find every visible 100 g/100 ml header position, not just one.
6. Match Portuguese nutrient row labels with conservative fuzzy matching.
7. Associate numeric cells with the nearest relevant per-100 column.
8. Fall back to ordered text parsing for legal linear/run-on layouts.
9. If only a known serving-basis value is available, scale linearly to 100 g/100 ml before consensus.
10. Never convert 100 ml to 100 g without density data.
11. Run multi-frame field-level consensus; contradictions remain separate candidates.
12. Stop when the per-100 basis and all required nutrient fields have stable repeated agreement.

This intentionally separates OCR recognition from semantic nutrition parsing. It allows us to replace/fine-tune the recognizer without rewriting the consensus/product layer.

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
4. Build a Brazilian dataset incrementally from user-corrected scans, with explicit consent/privacy handling, rather than collecting unlabeled images blindly.

## Critique cycles

### Cycle 1: shape assumptions

Initial skeleton assumption: a nutrition label behaves like one table whose OCR can be flattened and regexed.

Failure: ANVISA explicitly permits broken and linear forms, and real packages add perspective, paragraphs and fragmented OCR boxes.

Change made: polygons are retained; rows are reconstructed; multiple 100 g columns are supported; linear/run-on text has a separate ordered parser.

Remaining risk: aggregate labels can represent multiple products/preparations. We should refuse automatic save when multiple product columns are detected until a product-selection UI exists.

### Cycle 2: completion criteria and speed

Initial skeleton assumption: serving/household-unit OCR should be required before auto-stop.

Failure: that parenthetical text is often tiny and is not required for TrackFood's canonical per-100 nutrition. It can waste several expensive OCR frames after the useful data is already stable.

Change made: completion now requires canonical per-100 basis + required nutrient fields only. Serving data is retained when recognized but does not block stopping. The post-inference camera settle delay was reduced because PP-OCR runs sequentially and the camera usually advances while inference is running.

Remaining risk: first-use model download can dominate perceived latency. We should measure cold-start and warm-start time on Android Chrome and iPhone Safari before deciding whether to self-host/pre-cache model assets or add an explicit scanner preload action.

### Cycle 3: correctness versus false confidence

Initial temptation: if OCR sees `100 g` anywhere, assume nearby numbers are the 100 g values.

Failure: that can silently mix serving values, %VD and neighboring rows. A wrong value is worse than a partial result because users may not notice one bad digit.

Change made: geometry selects the actual per-100 column when available; ambiguous text columns remain unresolved; serving-basis values are standardized explicitly; consistency checks reject impossible sugar/fat relationships; recent contradictory frames can revoke an earlier confirmation.

Remaining risk: current fuzzy nutrient matching is heuristic. We need real-photo field-level evaluation before widening thresholds.

### Cycle 4: model choice

Candidate: Open Food Facts LayoutLMv3 extractor.

Critique: excellent task fit, but model size and non-commercial model license make it a poor browser product dependency.

Candidate: PaddleOCR-VL-1.6.

Critique: excellent robustness benchmark, but 0.9B parameters is excessive for the interactive PWA path.

Candidate: custom Tesseract training.

Critique: may improve characters but does not solve layout structure and would spend training effort on an engine that is already the weak baseline.

Decision: PP-OCRv6_small + geometry-aware Brazilian parser + multi-frame consensus is the shortest path that materially improves both recognition quality and product UX without committing us to a large server model or a bespoke training project.

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

For each image, record exact per-100 ground truth. Report:

- per-field exact accuracy
- full-label exact accuracy
- false-confirm rate (most important)
- unresolved/needs-review rate
- cold/warm model startup time
- inference latency per accepted frame
- time to automatic stop

Only after that benchmark should we decide whether PP-OCRv6 needs fine-tuning or a second numeric-specialist model.
