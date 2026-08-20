<script setup lang="ts">
import { ref } from "vue"
import { useRouter } from "vue-router"
import { parseBrazilianNutritionLabel, type OcrNutritionDraft } from "@/domain/ocr"
import { nutritionLabels } from "@/domain/nutrition"

const router = useRouter()
const status = ref("Upload or photograph a Brazilian nutrition label.")
const rawText = ref("")
const draft = ref<OcrNutritionDraft>()
const busy = ref(false)
const foodName = ref("")

async function recognize(file: File) {
  busy.value = true
  status.value = "Running OCR locally in this browser..."
  try {
    const Tesseract = await import("tesseract.js")
    const result = await Tesseract.recognize(file, "por+eng")
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
  draft.value = parseBrazilianNutritionLabel(rawText.value)
  status.value = `Parsed text. Confidence: ${draft.value.confidence}.`
}

async function reviewAsFood() {
  if (!draft.value) return
  sessionStorage.setItem(
    "trackfood:food-draft",
    JSON.stringify({
      name: foodName.value || "OCR food",
      nutritionBasis: draft.value.nutritionBasis,
      nutrition: draft.value.nutrition,
      servingUnits: draft.value.servingUnits,
      source: "label-ocr",
      sourceMetadata: { warnings: draft.value.warnings, confidence: draft.value.confidence, rawText: draft.value.text }
    })
  )
  await router.push("/foods/new")
}
</script>

<template>
  <div class="stack">
    <h1>Nutrition Label OCR</h1>
    <section class="card stack">
      <p class="muted">{{ status }}</p>
      <label>
        Photo or image
        <input type="file" accept="image/*" capture="environment" :disabled="busy" @change="onFile" />
      </label>
      <label>
        OCR text
        <textarea v-model="rawText" placeholder="Paste label text here if OCR is unavailable"></textarea>
      </label>
      <button :disabled="!rawText" @click="parseText">Parse pasted text</button>
    </section>

    <section v-if="draft" class="card stack">
      <div class="section-title">
        <h2>Editable draft</h2>
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
