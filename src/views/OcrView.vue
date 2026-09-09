<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { parseBrazilianNutritionLabel, type OcrNutritionDraft } from "@/domain/ocr"
import { nutritionLabels } from "@/domain/nutrition"
import { combineOcrObservations, MIN_OCR_QUALITY, NUTRIENT_KEYS, type OcrConsensus, type OcrObservation } from "@/domain/ocrConsensus"
import { createLabelCamera, LABEL_CROP } from "@/services/labelCamera"

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
let observations: OcrObservation[] = []
let camera: ReturnType<typeof createLabelCamera> | undefined
let disposed = false

function startCamera() {
  if (!video.value || busy.value || scanning.value) return
  camera?.stop()
  observations = []
  consensus.value = undefined
  draft.value = undefined
  rawText.value = ""
  frameCount.value = 0
  skippedCount.value = 0
  scanning.value = true
  camera = createLabelCamera(video.value, {
    onReading: (reading) => {
      frameCount.value++
      if (reading.confidence < MIN_OCR_QUALITY) skippedCount.value++
      observations.push({ id: frameCount.value, quality: reading.confidence, draft: parseBrazilianNutritionLabel(reading.text) })
      const result = combineOcrObservations(observations)
      observations = result.observations
      consensus.value = result
      draft.value = result.draft
      rawText.value = reading.text
      return result.ready
    },
    onStatus: (message) => { status.value = message },
    onStopped: () => { scanning.value = false }
  })
  void camera.start()
}

function stopCamera() {
  camera?.stop()
  status.value = "Camera stopped. Review the partial reading or start a fresh scan."
}

function onVisibilityChange() {
  if (document.hidden && scanning.value) stopCamera()
}

onMounted(() => document.addEventListener("visibilitychange", onVisibilityChange))
onBeforeUnmount(() => {
  disposed = true
  camera?.stop()
  document.removeEventListener("visibilitychange", onVisibilityChange)
})

async function recognize(file: File) {
  if (busy.value || scanning.value) return
  consensus.value = undefined
  draft.value = undefined
  busy.value = true
  status.value = "Running OCR locally in this browser..."
  try {
    const Tesseract = await import("tesseract.js")
    const result = await Tesseract.recognize(file, "por+eng")
    if (disposed) return
    rawText.value = result.data.text
    draft.value = parseBrazilianNutritionLabel(rawText.value)
    status.value = `OCR complete. Confidence: ${draft.value.confidence}. Review before saving.`
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
        warnings: draft.value.warnings, confidence: draft.value.confidence, rawText: draft.value.text,
        ...(consensus.value ? { multiFrame: { version: 1, frameCount: frameCount.value, basis: consensus.value.basis, fields: consensus.value.fields, serving: consensus.value.serving, ready: consensus.value.ready, observations: consensus.value.observations } } : {})
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
      <h2>Live label scan</h2>
      <p class="muted">Keep one label inside the guide, including the column headings and serving size. Adjust the angle slightly to avoid glare. Start a new scan for a different product.</p>
      <div class="label-camera">
        <video ref="video" muted playsinline aria-label="Live nutrition label camera"></video>
        <div class="label-guide" :style="{ left: `${LABEL_CROP.x * 100}%`, top: `${LABEL_CROP.y * 100}%`, width: `${LABEL_CROP.width * 100}%`, height: `${LABEL_CROP.height * 100}%` }" aria-hidden="true"></div>
      </div>
      <div class="actions">
        <button class="primary" :disabled="busy || scanning" @click="startCamera">{{ frameCount ? 'Start fresh scan' : 'Start camera' }}</button>
        <button :disabled="!scanning" @click="stopCamera">Stop camera</button>
      </div>
      <p role="status" aria-live="polite">{{ status }}</p>
      <template v-if="consensus">
        <p>{{ frameCount }} frames read · {{ skippedCount }} low-quality readings ignored</p>
        <label>
          {{ consensus.confirmedCount }} / {{ consensus.requiredCount }} fields confirmed
          <progress :value="consensus.confirmedCount" :max="consensus.requiredCount" aria-label="Confirmed label fields"></progress>
        </label>
        <p class="muted">Confirmation needs at least 3 matching readings and 85% weighted agreement. This measures agreement, not certainty. Missing fields stay blank; you can stop and review at any time.</p>
        <div class="row">
          <span>Nutrition basis</span>
          <span>{{ consensus.basis.confirmed ? 'Confirmed' : 'Pending' }} · {{ consensus.basis.support }} matches</span>
        </div>
        <div v-for="key in NUTRIENT_KEYS" :key="key" class="consensus-field">
          <div class="row">
            <span>{{ nutritionLabels[key] }}</span>
            <span>{{ consensus.fields[key].value ?? '—' }} · {{ consensus.fields[key].confirmed ? 'Confirmed' : 'Pending' }}</span>
          </div>
          <small v-if="consensus.fields[key].support" class="muted">
            {{ consensus.fields[key].support }} matches · {{ Math.round(consensus.fields[key].agreement * 100) }}% agreement
            <span v-if="consensus.fields[key].candidates.length > 1"> · Other readings: {{ consensus.fields[key].candidates.slice(1).map(candidate => candidate.value).join(', ') }}</span>
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
        Basis:
        <span v-if="draft.nutritionBasis?.type === 'mass'">{{ draft.nutritionBasis.grams }} g</span>
        <span v-else-if="draft.nutritionBasis?.type === 'volume'">{{ draft.nutritionBasis.ml }} ml</span>
        <span v-else>missing</span>
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
      <button class="primary" @click="reviewAsFood">Review and save as food</button>
    </section>
  </div>
</template>

<style scoped>
.label-camera { position: relative; background: #000; border-radius: 8px; overflow: hidden; }
.label-camera video { display: block; width: 100%; height: auto; min-height: 180px; }
.label-guide { position: absolute; border: 2px solid #fff; border-radius: 6px; box-shadow: 0 0 0 100vmax #0005; pointer-events: none; }
progress { width: 100%; accent-color: var(--accent); }
.consensus-field .row { border-bottom: 0; }
.consensus-field { border-bottom: 1px solid var(--line); padding-bottom: 0.4rem; }
</style>
