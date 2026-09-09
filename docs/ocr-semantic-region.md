# Semantic multi-photo nutrition region

Last reviewed: 2026-09-09

This note records the current green-polygon methodology for the deliberate nutrition-label scanner. It supersedes the older assumption that the live polygon should directly become the next OCR crop.

## Product rule

The green polygon is **explanatory feedback, not an OCR gate**. Every deliberate shutter press sends the complete dashed camera guide to PP-OCR. A wrong or incomplete green polygon therefore cannot make a missing nutrient invisible on the next photo.

This distinction is intentional. The user should be able to ask, "does TrackFood understand where the nutrition information is?" without having to trust that the answer also determines which pixels the recognizer is allowed to inspect.

## Per-photo semantic region

PP-OCR already returns text polygons. Instead of drawing a rectangle around arbitrary dense text, TrackFood uses known nutrition semantics to decide which OCR rows belong to the nutrition block.

The seeds are recognized nutrient labels, `100 g` / `100 ml`, serving/header text and the nutrition heading. Once nutrient rows have been found, rows geometrically between the first and last known nutrient are retained even if their nutrient name was the token OCR missed. This specifically protects cases such as a readable numeric Açúcares row whose word `Açúcares` was not recognized in that photo.

All OCR cells on a selected nutrition row are included, so numeric columns are part of the region rather than only the left-hand nutrient names. Single-cell headers such as `100 g` contribute to top/bottom extent but are not allowed to pull the estimated left/right table edges toward one column.

The polygon is estimated from row geometry rather than the older PCA-oriented rectangle. Text direction is used to deskew the row coordinates, and the left/right row envelopes are fitted separately as functions of vertical position. This gives a trapezoidal/perspective-aware quadrilateral and shifts each fitted side outward far enough to cover the observed nutrition rows.

## Learning across deliberate photos

Each accepted photo is another view of the same physical label. TrackFood therefore keeps a small semantic region memory inside the reused PP-OCR worker rather than treating every photo as unrelated.

Named OCR landmarks such as `carbsG`, `proteinG`, `fatG`, `sodiumMg`, `basis`, etc. provide correspondences across photos. For nutrient rows with a readable numeric side, TrackFood records both the nutrient-label landmark and a far-right row landmark so the correspondence set has useful horizontal as well as vertical spread.

The method is based on established document/image registration ideas:

- Greer et al. 2025, **Words as Geometric Features: Estimating Homography using Optical Character Recognition as Compressed Image Representation**. The paper uses OCR text identities and spatial positions as geometric features and robustly estimates document registration despite OCR noise: https://arxiv.org/abs/2505.18925
- OpenCV's planar object tutorial uses matched features, robust transformation estimation, and projection of object corners: https://docs.opencv.org/4.x/d7/dff/tutorial_feature_homography.html
- Character-keypoint document registration has likewise used OCR-derived character correspondences for camera/scanned document homography estimation: https://doi.org/10.1109/ICDARW.2019.30060

TrackFood first attempts a RANSAC-style affine registration from matching semantic landmarks. If the available landmarks are nearly collinear down the nutrient-name column, a rotation/scale/translation similarity transform is used instead of pretending a full affine model is identifiable. The prior semantic region is then transported into the new photo and useful extents discovered by either observation are retained.

This means the polygon can improve across photos. For example, photo 1 may clearly establish the top and sodium extent while photo 2 recognizes the previously missing sugar row. If enough named landmarks align the views, the second region can retain the extent learned from the first while adding the new semantic evidence.

## Live motion between OCR passes

The old live tracker sampled nine fixed points inside the box and fitted an affine transform. That can drift badly on a nutrition label because some grid points land on blank cells, repeated table rules or visually ambiguous text.

The active manual scanner now:

1. finds strong local corner/texture features inside the known region;
2. matches small patches forward into the next 96x72 tracking frame;
3. checks the match in the reverse direction;
4. rejects inconsistent correspondences;
5. fits the short-interval affine motion with a deterministic RANSAC-style inlier selection.

This follows the same motivation as the standard Shi-Tomasi + Lucas-Kanade sparse optical-flow pipeline described by OpenCV: choose trackable local features, then follow them through nearby frames rather than tracking arbitrary fixed pixels: https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html

The live tracker is intentionally only an incremental approximation. Large perspective changes are corrected by the next semantic PP-OCR re-anchor instead of asking the cheap 96x72 tracker to solve the whole projective problem.

## Shutter-time versus result-time coordinates

PP-OCR can take several seconds. A box calculated from the captured photo must not simply be pasted onto the live video after the user has moved the package.

The manual controller snapshots the tracked region at shutter time. If live tracking remains locked while OCR runs, the newly refined OCR region is transported from that shutter-time pose into the current pose before it is drawn. If tracking was lost, TrackFood avoids forcing stale captured-photo coordinates onto the current video.

## Critique cycle

Observed failure: the scanner could eventually read a label correctly, but the polygon often failed to cover all important nutrition pixels. Because the previous implementation also used that polygon as the next OCR crop, the user could reasonably suspect a self-reinforcing failure: the system says Açúcares is missing, draws a poor box that excludes Açúcares, then keeps scanning a crop that cannot recover it.

Changes made:

- completely separated the HUD ROI from the manual OCR crop;
- every manual photo now reads the whole dashed guide;
- derive the ROI from entire semantic nutrition rows, not just nutrient-name anchors;
- preserve rows inside the known nutrition span even when one label token is missing;
- estimate a perspective-aware row envelope instead of a PCA rectangle;
- keep semantic ROI memory across deliberate photos using named OCR landmarks;
- add right-side row landmarks to make multi-view registration better conditioned;
- fall back to similarity registration when semantic points are collinear instead of forcing an invalid affine solve;
- replace fixed-grid flow with strong-feature, forward/backward, robust affine tracking;
- transport delayed OCR geometry into the current live pose instead of blending stale photo coordinates directly into the current frame.

Remaining risks:

- flexible pouches and curved bottles are not planar, so no single homography/affine model is exact;
- a run-on nutrition paragraph may have too few distinct visual rows for a clean table-shaped quadrilateral;
- if PP-OCR fails to recognize enough semantic anchors in two consecutive photos, temporal semantic registration should reset to the current observation rather than smear unrelated geometry;
- very large hand motion while OCR runs can cause the live tracker to lose lock, in which case reacquisition is safer than pretending continuity.

The next empirical measurement should compare the polygon against manually annotated nutrition-region corners on the Brazilian photo benchmark. Useful metrics are region IoU/coverage, percentage of required nutrient OCR boxes lying inside the displayed region, tracker drift before the next OCR re-anchor, and most importantly whether any required field is ever excluded from the **actual OCR input**. In manual mode that last value should now be zero by construction.
