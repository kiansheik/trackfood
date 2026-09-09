<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { parseBrazilianNutritionLabel, type OcrNutritionDraft } from "@/domain/ocr"
import { nutritionLabels } from "@/domain/nutrition"
import {
  combineOcrObservations,
  MIN_OCR_QUALITY,
  MIN_SUPPORT,
  NUTRIENT_KEYS,
  type FieldEvidence,
  type OcrConsensus,
  type OcrObservation
} from "@/domain/ocrConsensus"
import {
  createLabelCamera,
  LABEL_CROP,
  type CameraPipelineState,
  type CaptureGuidance
} from "@/services/labelCamera"
import { recognizeLabelBlob } from "@/services/paddleLabelReader"

const router = useRouter()
const status = ref("Upload or photograph a Brazilian nutrition label.")
const rawText = ref("")
const draft = ref<OcrNutritionDraft>()
const busy = ref(false)
const foodName = ref("")
const video = ref<HTMLVideoElement>()
const scanning = ref(false)
const consensus = ref<OcrConsensus>()
const frameCount = ref(0)
const skippedCount = ref(0)
const engine = ref("")
const inferenceMs = ref<number>()
const capturePulse = ref(false)
const pipeline = ref<CameraPipelineState>({
  guidance: "warming",
  queued: 0,
  captured: 0,
  processed: 0,
  dropped: 0,
  processing: false,
  lastCaptureAccepted: false
})
let observations: OcrObservation[] = []
let camera: ReturnType<typeof createLabelCamera> | undefined
let disposed = false
let capturePulseTimer: ReturnType<typeof setTimeout> | undefined

const scanState = computed(() => {
  if (consensus.value?.ready) return "Complete"
  if (scanning.value) return "Scanning"
  if (frameCount.value) return "Paused"
  return "Idle"
})

type EvidenceState = "confirmed" | "conflict" | "collecting" | "missing"

function evidenceState(evidence: FieldEvidence<unknown>): EvidenceState {
  if (evidence.confirmed) return "confirmed"
  if (evidence.candidates.length > 1) return "conflict"
  if (evidence.support > 0) return "collecting"
  return "missing"
}

function evidenceLabel(evidence: FieldEvidence<unknown>): string {
  const state = evidenceState(evidence)
  if (state === "confirmed") return "Confirmed"
  if (state === "conflict") return "Conflict"
  if (state === "collecting") return "Reading"
  return "Missing"
}

function candidateSummary(evidence: FieldEvidence<number>): string {
  return evidence.candidates.map((candidate) => `${candidate.value} (${candidate.support})`).join(" · ")
}

const fieldHud = computed(() => {
  const current = consensus.value
  return [
    { key: "basis", label: "100 g/ml", state: current ? evidenceState(current.basis) : "missing" as EvidenceState },
    ...NUTRIENT_KEYS.map((key) => ({
      key,
      label: nutritionLabels[key],
      state: current ? evidenceState(current.fields[key]) : "missing" as EvidenceState
    }))
  ]
})

const pendingFields = computed(() => fieldHud.value.filter((field) => field.state !== "confirmed"))
const pendingSummary = computed(() => {
  const fields = pendingFields.value
  if (!fields.length) return "All per-100 fields confirmed"
  const labels = fields.slice(0, 3).map((field) => field.label)
  return `${fields.some((field) => field.state === "conflict") ? "Recheck" : "Still need"}: ${labels.join(", ")}${fields.length > 3 ? ` +${fields.length - 3}` : ""}`
})

const progressRatio = computed(() => {
  if (!consensus.value?.requiredCount) return 0
  return consensus.value.confirmedCount / consensus.value.requiredCount
})
const cameraFrameStyle = computed<Record<string, string>>(() => ({
  "--scan-progress": `${Math.round(progressRatio.value * 360)}deg`
}))

function guidanceText(guidance: CaptureGuidance): string {
  if (!scanning.value) return consensus.value?.ready ? "Scan complete" : frameCount.value ? "Paused — review or continue" : "Center the nutrition label to begin"
  if (guidance === "warming") return "Starting camera…"
  if (guidance === "dark") return "More light will help the small print"
  if (guidance === "glare") return "Tilt the package slightly to reduce glare"
  if (guidance === "blurry") return "Hold still and let the camera focus"
  if (guidance === "frozen") return "Move or tilt slightly for a different shot"
  if (pipeline.value.lastCaptureAccepted) return "Captured — keep it framed, then vary the angle a little"
  if (pipeline.value.processing && pipeline.value.queued) return "OCR is working — more shots are already queued"
  if (pipeline.value.processing) return "OCR is working — hold steady for the next snapshot"
  return "Hold the whole label steady inside the guide"
}

const queueText = computed(() => {
  if (!scanning.value) return ""
  const processing = pipeline.value.processing ? "1 processing" : "OCR ready"
  return `${processing} · ${pipeline.value.queued} queued · ${pipeline.value.captured} captured`
})

function resetPipeline() {
  pipeline.value = {
    guidance: "warming",
    queued: 0,
    captured: 0,
    processed: 0,
    dropped: 0,
    processing: false,
    lastCaptureAccepted: false
  }
}

function updatePipeline(next: CameraPipelineState) {
  if (next.captured > pipeline.value.captured) {
    capturePulse.value = true
    clearTimeout(capturePulseTimer)
    capturePulseTimer = setTimeout(() => { capturePulse.value = false }, 260)
  }
  pipeline.value = next
}

function startCamera(fresh = true) {
  if (!video.value || busy.value || scanning.value) return
  camera?.stop()
  if (fresh) {
    observations = []
    consensus.value = undefined
    draft.value = undefined
    rawText.value = ""
    engine.value = ""
    inferenceMs.value = undefined
    frameCount.value = 0
    skippedCount.value = 0
  }
  resetPipeline()
  scanning.value = true
  camera = createLabelCamera(video.value, {
    onReading: (reading) => {
      frameCount.value++
      if (reading.confidence < MIN_OCR_QUALITY) skippedCount.value++
      engine.value = reading.engine ?? "OCR"
      inferenceMs.value = reading.inferenceMs
      observations.push({ id: frameCount.value, quality: reading.confidence, draft: parseBrazilianNutritionLabel(reading.text, reading.layout) })
      const result = combineOcrObservations(observations)
      observations = result.observations
      consensus.value = result
      draft.value = result.draft
      rawText.value = reading.text
      return result.ready
    },
    onStatus: (message) => { status.value = message },
    onPipeline: updatePipeline,
    onStopped: () => { scanning.value = false }
  })
  void camera.start()
}

function startOrContinue() {
  startCamera(frameCount.value === 0 || !!consensus.value?.ready)
}

function startFresh() {
  startCamera(true)
}

function stopCamera() {
  camera?.stop()
  status.value = "Paused. Your confirmed and partial fields are preserved; continue scanning or use the current result."
}

function onVisibilityChange() {
  if (document.hidden && scanning.value) stopCamera()
}

onMounted(() => document.addEventListener("visibilitychange", onVisibilityChange))
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(capturePulseTimer)
  camera?.stop()
  document.removeEventListener("visibilitychange", onVisibilityChange)
})

async function recognize(file: File) {
  if (busy.value || scanning.value) return
  consensus.value = undefined
  draft.value = undefined
  busy.value = true
  status.value = "Preparing PP-OCRv6 and reading the label locally..."
  try {
    const reading = await recognizeLabelBlob(file)
    if (disposed) return
    rawText.value = reading.text
    engine.value = reading.engine ?? "PP-OCRv6-small"
    inferenceMs.value = reading.inferenceMs
    draft.value = parseBrazilianNutritionLabel(reading.text, reading.layout)
    status.value = `OCR complete with ${engine.value}. Review the standardized 100 g/100 ml values before saving.`
  } catch (err) {
    status.value = err instanceof Error ? err.message : "OCR failed. Paste text or enter manually."
  } finally {
    busy.value = false
  }
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void recognize(file)
}

function parseText() {
  if (busy.value || scanning.value) return
  consensus.value = undefined
  engine.value = "Pasted text"
  draft.value = parseBrazilianNutritionLabel(rawText.value)
  status.value = `Parsed text. Confidence: ${draft.value.confidence}.`
}

async function reviewAsFood() {
  if (!draft.value) return
  camera?.stop()
  sessionStorage.setItem(
    "trackfood:food-draft",
    JSON.stringify({
      name: foodName.value || "OCR food",
      nutritionBasis: draft.value.nutritionBasis,
      nutrition: draft.value.nutrition,
      servingUnits: draft.value.servingUnits,
      source: "label-ocr",
      sourceMetadata: {
        warnings: draft.value.warnings,
        confidence: draft.value.confidence,
        rawText: draft.value.text,
        standardization: draft.value.standardization,
        engine: engine.value,
        inferenceMs: inferenceMs.value,
        ...(consensus.value ? { multiFrame: { version: 3, frameCount: frameCount.value, basis: consensus.value.basis, fields: consensus.value.fields, serving: consensus.value.serving, ready: consensus.value.ready, observations: consensus.value.observations } } : {})
      }
    })
  )
  await router.push("/foods/new")
}
</script>

<template>
  <div class="stack">
    <h1>Nutrition Label OCR</h1>
    <section class="card stack">
      <div class="section-title">
        <h2>Live label scan</h2>
        <span class="pill" data-testid="scan-state">{{ scanState }}</span>
      </div>
      <p class="muted">Keep the whole nutrition block inside the guide, especially the 100 g/100 ml heading. TrackFood captures a small queue while PP-OCRv6 works, so you can keep supplying clear, slightly different angles instead of waiting between every inference.</p>

      <div
        class="camera-progress-frame"
        :class="{ 'capture-pulse': capturePulse }"
        :data-guidance="pipeline.guidance"
        :style="cameraFrameStyle"
        data-testid="camera-progress-frame"
      >
        <div class="label-camera" data-testid="label-camera">
          <video ref="video" muted playsinline aria-label="Live nutrition label camera"></video>
          <div class="label-guide" :style="{ left: `${LABEL_CROP.x * 100}%`, top: `${LABEL_CROP.y * 100}%`, width: `${LABEL_CROP.width * 100}%`, height: `${LABEL_CROP.height * 100}%` }" aria-hidden="true"></div>

          <div class="hud hud-top" aria-live="polite">
            <strong data-testid="hud-guidance">{{ guidanceText(pipeline.guidance) }}</strong>
            <span v-if="consensus" class="hud-count" data-testid="hud-count">{{ consensus.confirmedCount }}/{{ consensus.requiredCount }}</span>
          </div>

          <div class="hud hud-bottom">
            <div class="hud-dots" data-testid="hud-fields" aria-label="Nutrition field progress">
              <span
                v-for="field in fieldHud"
                :key="field.key"
                class="hud-dot"
                :data-state="field.state"
                :title="`${field.label}: ${field.state}`"
              ></span>
            </div>
            <strong class="hud-pending" data-testid="hud-pending">{{ pendingSummary }}</strong>
            <small v-if="queueText">{{ queueText }}</small>
          </div>
          <div v-if="capturePulse" class="capture-flash" aria-hidden="true"></div>
        </div>
      </div>

      <div class="actions scan-actions">
        <button class="primary" data-testid="start-camera" :disabled="busy || scanning" @click="startOrContinue">
          {{ frameCount && !consensus?.ready ? 'Continue scan' : frameCount ? 'Start fresh scan' : 'Start camera' }}
        </button>
        <button data-testid="stop-camera" :disabled="!scanning" @click="stopCamera">Pause</button>
        <button v-if="frameCount" :disabled="scanning" @click="startFresh">Start over</button>
        <button class="primary" data-testid="use-current-result" :disabled="!draft" @click="reviewAsFood">Use current result</button>
      </div>
      <p class="muted compact">You never have to wait for 100%. Pause whenever the values you need look right, then review/edit them before saving. The next screen also lets you name the food, add the brand, and register a barcode.</p>
      <p data-testid="scan-status" role="status" aria-live="polite">{{ status }}</p>
      <p v-if="engine" class="muted" data-testid="ocr-engine">{{ engine }}<span v-if="inferenceMs"> · {{ Math.round(inferenceMs) }} ms last inference</span></p>

      <template v-if="consensus">
        <div class="section-title scan-summary">
          <div>
            <strong>{{ frameCount }} OCR results processed</strong>
            <p class="muted">{{ pipeline.captured }} snapshots captured · {{ pipeline.dropped }} skipped/replaced · {{ skippedCount }} low-quality OCR results ignored</p>
          </div>
          <strong>{{ consensus.confirmedCount }} / {{ consensus.requiredCount }}</strong>
        </div>
        <label>
          Fields confirmed
          <progress data-testid="overall-progress" :value="consensus.confirmedCount" :max="consensus.requiredCount" aria-label="Confirmed label fields"></progress>
        </label>
        <p v-if="consensus.ready" class="scan-complete" data-testid="scan-complete">All required per-100 fields have repeated agreement. The camera stops automatically so the composite cannot drift after completion.</p>
        <p v-else class="muted">Confirmation needs at least {{ MIN_SUPPORT }} matching readings and 85% weighted agreement, plus agreement in the latest readings. Missing and contradictory values stay visibly unresolved. You can pause and use the partial result at any time.</p>

        <div class="consensus-field" data-testid="field-basis" :data-state="evidenceState(consensus.basis)">
          <div class="row">
            <span>Nutrition basis</span>
            <strong>{{ evidenceLabel(consensus.basis) }}</strong>
          </div>
          <progress class="field-progress" :value="Math.min(consensus.basis.support, MIN_SUPPORT)" :max="MIN_SUPPORT" aria-label="Nutrition basis evidence"></progress>
          <small class="muted">
            {{ consensus.basis.support }} matches
            <span v-if="consensus.basis.support"> · {{ Math.round(consensus.basis.agreement * 100) }}% agreement</span>
          </small>
        </div>

        <div
          v-for="key in NUTRIENT_KEYS"
          :key="key"
          class="consensus-field"
          :data-testid="`field-${key}`"
          :data-state="evidenceState(consensus.fields[key])"
        >
          <div class="row">
            <span>{{ nutritionLabels[key] }}</span>
            <strong>{{ consensus.fields[key].value ?? '—' }} · {{ evidenceLabel(consensus.fields[key]) }}</strong>
          </div>
          <progress class="field-progress" :value="Math.min(consensus.fields[key].support, MIN_SUPPORT)" :max="MIN_SUPPORT" :aria-label="`${nutritionLabels[key]} evidence`"></progress>
          <small v-if="consensus.fields[key].support" class="muted">
            {{ consensus.fields[key].support }} matches · {{ Math.round(consensus.fields[key].agreement * 100) }}% agreement
          </small>
          <small v-if="consensus.fields[key].candidates.length > 1" class="conflict-detail">
            Conflicting readings: {{ candidateSummary(consensus.fields[key]) }}
          </small>
        </div>
      </template>
    </section>

    <section class="card stack">
      <h2>Photo or pasted text</h2>
      <label>
        Photo or image
        <input type="file" accept="image/*" capture="environment" :disabled="busy || scanning" @change="onFile" />
      </label>
      <label>
        OCR text
        <textarea v-model="rawText" :disabled="busy || scanning" placeholder="Paste label text here if OCR is unavailable"></textarea>
      </label>
      <button :disabled="!rawText || busy || scanning" @click="parseText">{{ consensus ? 'Use this text instead of composite' : 'Parse pasted text' }}</button>
    </section>

    <section v-if="draft" class="card stack">
      <div class="section-title">
        <h2>{{ consensus ? 'Composite draft' : 'Editable draft' }}</h2>
        <span class="pill">{{ draft.confidence }}</span>
      </div>
      <p v-for="warning in draft.warnings" :key="warning" class="muted">{{ warning }}</p>
      <p class="muted">
        Canonical basis:
        <span v-if="draft.nutritionBasis?.type === 'mass'">{{ draft.nutritionBasis.grams }} g</span>
        <span v-else-if="draft.nutritionBasis?.type === 'volume'">{{ draft.nutritionBasis.ml }} ml</span>
        <span v-else>missing</span>
        · {{ draft.standardization }}
      </p>
      <div v-for="(value, key) in draft.nutrition" :key="key" class="row">
        <span>{{ nutritionLabels[key] }}</span>
        <strong>{{ value }}</strong>
      </div>
      <div v-for="unit in draft.servingUnits" :key="unit.id" class="row">
        <span>{{ unit.quantity }} {{ unit.plural }}</span>
        <strong>{{ unit.grams ?? unit.ml }} {{ unit.grams ? "g" : "ml" }}</strong>
      </div>
      <label>Food name<input v-model="foodName" placeholder="Name for the review form" /></label>
      <button class="primary" @click="reviewAsFood">Use these values → name, brand & barcode</button>
    </section>
  </div>
</template>

<style scoped>
.camera-progress-frame {
  --scan-progress: 0deg;
  padding: 4px;
  border-radius: 12px;
  background: conic-gradient(var(--accent) var(--scan-progress), color-mix(in srgb, var(--line) 70%, transparent) 0);
  transition: background 180ms ease, box-shadow 180ms ease;
}
.camera-progress-frame[data-guidance="dark"],
.camera-progress-frame[data-guidance="glare"],
.camera-progress-frame[data-guidance="blurry"] { box-shadow: 0 0 0 3px #d99a31; }
.camera-progress-frame[data-guidance="frozen"] { box-shadow: 0 0 0 3px var(--danger); }
.camera-progress-frame.capture-pulse { box-shadow: 0 0 0 4px var(--accent), 0 0 18px color-mix(in srgb, var(--accent) 55%, transparent); }
.label-camera { position: relative; background: #000; border-radius: 8px; overflow: hidden; min-height: 220px; }
.label-camera video { display: block; width: 100%; height: auto; min-height: 220px; object-fit: cover; }
.label-guide { position: absolute; border: 2px solid #fff; border-radius: 6px; box-shadow: 0 0 0 100vmax #0004; pointer-events: none; }
.hud { position: absolute; left: 0; right: 0; z-index: 3; color: #fff; text-shadow: 0 1px 2px #000; pointer-events: none; }
.hud-top { top: 0; display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; padding: 0.7rem; background: linear-gradient(#000a, transparent); }
.hud-top strong { max-width: 80%; font-size: 0.92rem; }
.hud-count { background: #0009; border: 1px solid #fff7; border-radius: 999px; padding: 0.25rem 0.5rem; font-weight: 700; white-space: nowrap; }
.hud-bottom { bottom: 0; display: grid; gap: 0.35rem; padding: 2rem 0.7rem 0.7rem; background: linear-gradient(transparent, #000c 45%); }
.hud-bottom small { opacity: 0.9; }
.hud-dots { display: grid; grid-template-columns: repeat(11, minmax(8px, 1fr)); gap: 4px; }
.hud-dot { height: 6px; border-radius: 999px; background: #ffffff55; border: 1px solid #ffffff66; }
.hud-dot[data-state="confirmed"] { background: var(--accent); border-color: var(--accent); }
.hud-dot[data-state="conflict"] { background: var(--danger); border-color: var(--danger); }
.hud-dot[data-state="collecting"] { background: #f0bd57; border-color: #f0bd57; }
.hud-pending { font-size: 0.86rem; line-height: 1.2; }
.capture-flash { position: absolute; inset: 0; z-index: 2; border: 3px solid var(--accent); pointer-events: none; animation: capture-flash 260ms ease-out both; }
@keyframes capture-flash { from { opacity: 1; } to { opacity: 0; } }
progress { width: 100%; accent-color: var(--accent); }
.scan-actions { align-items: center; }
.compact { margin-top: -0.3rem; }
.scan-summary { margin-bottom: 0; }
.scan-summary p { margin: 0.2rem 0 0; }
.scan-complete { border-left: 3px solid var(--accent); padding-left: 0.7rem; margin-bottom: 0; }
.consensus-field { border-bottom: 1px solid var(--line); padding-bottom: 0.55rem; }
.consensus-field .row { border-bottom: 0; padding-bottom: 0.25rem; }
.field-progress { height: 7px; }
.consensus-field[data-state="confirmed"] strong { color: var(--accent); }
.consensus-field[data-state="conflict"] strong,
.conflict-detail { color: var(--danger); }
.conflict-detail { display: block; margin-top: 0.25rem; }
@media (max-width: 520px) {
  .label-camera, .label-camera video { min-height: 260px; }
  .hud-top strong { font-size: 0.84rem; }
  .hud-pending { font-size: 0.78rem; }
}
</style>
