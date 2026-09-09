# Deliberate nutrition-label capture mode

Last reviewed: 2026-09-09

This note supersedes the older automatic snapshot-queue sections in `docs/ocr-methodology.md` for the active TrackFood product flow.

The camera remains live only as a preview and lightweight tracking surface. Opening the scanner starts camera permission, PP-OCR initialization, and nutrition-region tracking. It does **not** create OCR observations automatically.

An observation is created only when the user deliberately taps the camera viewport. The viewport is visibly pressable once the OCR worker is ready. As soon as a photo is accepted, the viewport dims and disables until that one PP-OCR inference is complete. There is no background capture queue in this mode.

The tapped image still passes the cheap capture-quality assessment and frozen-frame guard before OCR. A rejected frame increments a rejected-photo counter but never reaches `combineOcrObservations`, so it cannot alter field support, agreement, or confirmation. Effectively identical perceptual frames are rejected more narrowly than in the old streaming collector because a deliberate shutter press is already stronger evidence of independence than a timer-generated frame.

PP-OCR polygons still anchor the detected nutrition region, and the lightweight optical-flow tracker continues following that region between manual photos. The tracked region is therefore useful for framing and adaptive cropping without being confused with nutritional evidence.

The intent is to trade automatic throughput for higher-value observations. PP-OCR browser inference is expensive enough that a knowingly poor angle is usually not worth processing. A person holding the package can cheaply inspect glare, curvature, crop and focus and decide when another image is likely to add information.

The consensus layer remains conservative. Deliberate photos do not bypass the physical/regulatory plausibility checks or multi-observation requirements. Clean, internally consistent labels can complete after three deliberate observations. Plausible conflicts remain unresolved. Physically impossible OCR outliers can be discarded by the constraint layer.

When the composite reaches all but one required field, the scanner explicitly suggests leaving OCR and finishing that field in the normal editable food form. This is intentional. The optimization target is not `11/11 by OCR at any cost`; it is the shortest reliable path to a correct editable nutrition record.

Regression expectations for this mode:

- opening the camera does not create an OCR observation;
- tapping the viewport creates at most one in-flight OCR job;
- the viewport is disabled and visually muted while that job is running;
- a failed capture-quality check never reaches OCR or consensus;
- an effectively identical frozen frame is not counted twice;
- accepted manual photos preserve the existing region-tracking and consensus behavior;
- three clean deliberate observations can complete a label;
- a label with one unresolved required field offers a manual-finish path rather than pressuring the user to keep taking photos.
