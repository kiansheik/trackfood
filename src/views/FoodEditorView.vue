<script setup lang="ts">
import { computed, reactive, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { parseDecimalInput, requiredDecimal, roundForDisplay } from "@/domain/number"
import { gramsPerUnit, mlPerUnit, nutritionKeys, nutritionLabels } from "@/domain/nutrition"
import type { Food, FoodSource, Nutrition, ServingUnit } from "@/domain/types"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const route = useRoute()
const router = useRouter()
const existing = computed(() => store.foods.find((food) => food.id === route.params.id))
const error = ref("")

const draftFromSession = sessionStorage.getItem("trackfood:food-draft")
const sessionDraft = draftFromSession ? (JSON.parse(draftFromSession) as Partial<Food>) : undefined
if (sessionDraft) sessionStorage.removeItem("trackfood:food-draft")

const form = reactive({
  name: existing.value?.name ?? sessionDraft?.name ?? "",
  brand: existing.value?.brand ?? sessionDraft?.brand ?? "",
  barcode: existing.value?.barcode ?? sessionDraft?.barcode ?? String(route.query.barcode ?? ""),
  basisType: existing.value?.nutritionBasis.type ?? sessionDraft?.nutritionBasis?.type ?? "mass",
  basisAmount:
    existing.value?.nutritionBasis.type === "volume"
      ? String(existing.value.nutritionBasis.ml)
      : existing.value?.nutritionBasis.type === "mass"
        ? String(existing.value.nutritionBasis.grams)
        : sessionDraft?.nutritionBasis?.type === "volume"
          ? String(sessionDraft.nutritionBasis.ml)
          : sessionDraft?.nutritionBasis?.type === "mass"
            ? String(sessionDraft.nutritionBasis.grams)
            : "100",
  source: existing.value?.source ?? sessionDraft?.source ?? "manual",
  nutrients: Object.fromEntries(nutritionKeys.map((key) => [key, String((existing.value?.nutrition ?? sessionDraft?.nutrition ?? {})[key] ?? "")])) as Record<string, string>,
  servingUnits: (existing.value?.servingUnits ?? sessionDraft?.servingUnits ?? []).map((unit) => ({ ...unit }))
})

function addUnit() {
  form.servingUnits.push({
    id: crypto.randomUUID(),
    singular: "unidade",
    plural: "unidades",
    quantity: 1,
    grams: form.basisType === "mass" ? 1 : undefined,
    ml: form.basisType === "volume" ? 1 : undefined
  })
}

function removeUnit(id: string) {
  form.servingUnits = form.servingUnits.filter((unit) => unit.id !== id)
}

async function save() {
  try {
    error.value = ""
    const basisAmount = requiredDecimal(form.basisAmount, "Base nutricional")
    const nutrition: Nutrition = {}
    for (const key of nutritionKeys) {
      const parsed = parseDecimalInput(form.nutrients[key])
      if (parsed !== undefined) nutrition[key] = parsed
    }
    const now = new Date().toISOString()
    const food: Food = {
      id: existing.value?.id ?? crypto.randomUUID(),
      name: form.name.trim(),
      brand: form.brand.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      nutritionBasis: form.basisType === "mass" ? { type: "mass", grams: basisAmount } : { type: "volume", ml: basisAmount },
      nutrition,
      servingUnits: form.servingUnits.map(cleanUnit),
      source: form.source as FoodSource,
      sourceMetadata: existing.value?.sourceMetadata ?? sessionDraft?.sourceMetadata,
      createdAt: existing.value?.createdAt ?? now,
      updatedAt: now
    }
    if (!food.name) throw new Error("Nome do alimento é obrigatório.")
    await store.saveFood(food)
    await router.push(`/log/${food.id}`)
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Não foi possível salvar."
  }
}

async function deleteFood() {
  if (!existing.value || !confirm("Delete this local food? Diary snapshots remain unchanged.")) return
  await store.deleteFood(existing.value.id)
  await router.push("/foods")
}

function cleanUnit(unit: ServingUnit): ServingUnit {
  const quantity = requiredDecimal(unit.quantity, "Quantidade da unidade")
  const grams = form.basisType === "mass" ? requiredDecimal(unit.grams, "Gramas da unidade") : undefined
  const ml = form.basisType === "volume" ? requiredDecimal(unit.ml, "Mililitros da unidade") : undefined
  return {
    id: unit.id || crypto.randomUUID(),
    singular: unit.singular.trim() || "unidade",
    plural: unit.plural.trim() || `${unit.singular.trim()}s`,
    quantity,
    grams,
    ml
  }
}
</script>

<template>
  <form class="stack" @submit.prevent="save">
    <div class="section-title">
      <h1>{{ existing ? "Edit Food" : "Add Food" }}</h1>
      <button class="primary" type="submit">Save</button>
    </div>
    <p v-if="form.source !== 'manual'" class="card muted">
      Source: {{ form.source }}. Review every field before saving locally.
    </p>
    <p v-if="error" class="card danger">{{ error }}</p>

    <section class="card form-grid">
      <label>Name<input v-model="form.name" required autocomplete="off" /></label>
      <label>Brand<input v-model="form.brand" autocomplete="off" /></label>
      <label>Barcode<input v-model="form.barcode" inputmode="numeric" autocomplete="off" /></label>
      <label>
        Source
        <select v-model="form.source">
          <option value="manual">Manual</option>
          <option value="open-food-facts">Open Food Facts</option>
          <option value="label-ocr">Label OCR</option>
        </select>
      </label>
    </section>

    <section class="card stack">
      <h2>Nutrition basis</h2>
      <div class="inline">
        <label>
          Basis
          <select v-model="form.basisType">
            <option value="mass">per grams</option>
            <option value="volume">per ml</option>
          </select>
        </label>
        <label>
          Amount
          <input v-model="form.basisAmount" inputmode="decimal" placeholder="100" />
        </label>
      </div>
      <div class="form-grid">
        <label v-for="key in nutritionKeys" :key="key">
          {{ nutritionLabels[key] }} {{ key === "sodiumMg" ? "(mg)" : key === "kcal" ? "(kcal)" : "(g)" }}
          <input v-model="form.nutrients[key]" inputmode="decimal" placeholder="blank if unknown" />
        </label>
      </div>
    </section>

    <section class="card stack">
      <div class="section-title">
        <h2>Human serving units</h2>
        <button type="button" @click="addUnit">Add unit</button>
      </div>
      <article v-for="unit in form.servingUnits" :key="unit.id" class="card">
        <div class="form-grid">
          <label>Singular<input v-model="unit.singular" /></label>
          <label>Plural<input v-model="unit.plural" /></label>
          <label>Printed quantity<input v-model.number="unit.quantity" inputmode="decimal" /></label>
          <label v-if="form.basisType === 'mass'">Printed grams<input v-model.number="unit.grams" inputmode="decimal" /></label>
          <label v-else>Printed ml<input v-model.number="unit.ml" inputmode="decimal" /></label>
        </div>
        <p class="muted" style="margin-top: 0.7rem">
          Preview:
          1 {{ unit.singular || "unit" }} =
          <template v-if="form.basisType === 'mass'">{{ roundForDisplay(gramsPerUnit(unit) ?? 0, 2) }} g</template>
          <template v-else>{{ roundForDisplay(mlPerUnit(unit) ?? 0, 2) }} ml</template>
        </p>
        <button class="danger" type="button" @click="removeUnit(unit.id)">Remove</button>
      </article>
      <p class="muted">Example: enter printed quantity 4.75 and printed grams 30 to log unidades directly.</p>
    </section>

    <div class="actions">
      <button class="primary" type="submit">Save Food</button>
      <button v-if="existing" class="danger" type="button" @click="deleteFood">Delete Food</button>
    </div>
  </form>
</template>
