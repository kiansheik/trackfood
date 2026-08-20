<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useRoute } from "vue-router"
import { entriesForDate, isoDate, nutritionForEntries } from "@/domain/budget"
import { formatNumber, parseDecimalInput } from "@/domain/number"
import { availableUnits, nutritionForPortion, nutritionLabels } from "@/domain/nutrition"
import type { Food } from "@/domain/types"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const route = useRoute()
const query = ref("")
const selectedId = ref(String(route.params.foodId ?? ""))
const date = ref(isoDate())
const meal = ref(store.settings.mealNames[0])
const amount = ref("1")
const unitId = ref("g")
const quickLabel = ref("Quick calories")
const quickKcal = ref("")
const message = ref("")

const selectedFood = computed(() => store.foods.find((food) => food.id === selectedId.value))
const units = computed(() => (selectedFood.value ? availableUnits(selectedFood.value) : []))
const filteredFoods = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return [...store.recentFoods, ...store.frequentFoods.filter((food) => !store.recentFoods.some((recent) => recent.id === food.id))]
  return store.foods.filter((food) =>
    [food.name, food.brand, food.barcode].filter(Boolean).some((value) => value!.toLowerCase().includes(needle))
  )
})
const preview = computed(() => {
  const parsed = parseDecimalInput(amount.value)
  if (!selectedFood.value || parsed === undefined || !unitId.value) return undefined
  try {
    return nutritionForPortion(selectedFood.value, parsed, unitId.value)
  } catch {
    return undefined
  }
})
const dayEntries = computed(() => entriesForDate(store.diaryEntries, date.value))
const dayNutrition = computed(() => nutritionForEntries(dayEntries.value))

watch(selectedFood, (food) => {
  if (food) unitId.value = availableUnits(food)[0]?.id ?? "g"
}, { immediate: true })

function choose(food: Food) {
  selectedId.value = food.id
  query.value = ""
}

async function logFood() {
  const parsed = parseDecimalInput(amount.value)
  if (!selectedFood.value || parsed === undefined) return
  await store.logFood({ food: selectedFood.value, date: date.value, meal: meal.value, amount: parsed, unitId: unitId.value })
  message.value = "Logged."
}

async function logQuick() {
  const kcal = parseDecimalInput(quickKcal.value)
  if (kcal === undefined) return
  await store.logQuickCalories({ date: date.value, meal: meal.value, label: quickLabel.value || "Quick calories", kcal })
  quickKcal.value = ""
  message.value = "Quick calories logged."
}
</script>

<template>
  <div class="stack">
    <h1>Log Food</h1>
    <p v-if="message" class="card">{{ message }}</p>

    <section class="grid two">
      <article class="card stack">
        <h2>Food</h2>
        <label>
          Search
          <input v-model="query" type="search" placeholder="Recent, frequent or search all foods" />
        </label>
        <div class="pill-list">
          <button v-for="food in filteredFoods" :key="food.id" type="button" @click="choose(food)">
            {{ food.name }}
          </button>
        </div>
        <p v-if="!store.foods.length" class="muted">Create a food first, or use quick calories below.</p>
      </article>

      <article class="card stack">
        <h2>Amount</h2>
        <p v-if="selectedFood" class="muted">{{ selectedFood.name }}</p>
        <div class="inline">
          <label>Date<input v-model="date" type="date" /></label>
          <label>
            Meal
            <select v-model="meal">
              <option v-for="name in store.settings.mealNames" :key="name">{{ name }}</option>
            </select>
          </label>
        </div>
        <div class="inline">
          <label>Amount<input v-model="amount" inputmode="decimal" /></label>
          <label>
            Unit
            <select v-model="unitId">
              <option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.label }}</option>
            </select>
          </label>
        </div>
        <p class="muted" v-if="preview">
          ≈
          <span v-if="preview.grams">{{ formatNumber(preview.grams, store.settings.locale, 2) }} g</span>
          <span v-if="preview.ml">{{ formatNumber(preview.ml, store.settings.locale, 2) }} ml</span>
          · {{ formatNumber(preview.nutrition.kcal ?? 0, store.settings.locale) }} kcal
        </p>
        <button class="primary" :disabled="!selectedFood || !preview" @click="logFood">Log</button>
      </article>
    </section>

    <section class="card stack">
      <h2>Quick calories</h2>
      <div class="inline">
        <label>Label<input v-model="quickLabel" /></label>
        <label>kcal<input v-model="quickKcal" inputmode="decimal" /></label>
      </div>
      <button @click="logQuick">Log quick calories</button>
    </section>

    <section class="card">
      <div class="section-title">
        <h2>{{ date }}</h2>
        <strong>{{ formatNumber(dayNutrition.kcal ?? 0, store.settings.locale) }} kcal</strong>
      </div>
      <div v-for="entry in [...dayEntries].reverse()" :key="entry.id" class="row">
        <div>
          <strong>{{ entry.foodName }}</strong>
          <p class="muted">{{ entry.amount }} {{ entry.unitLabel }} · {{ entry.meal }}</p>
        </div>
        <div>
          <strong>{{ formatNumber(entry.nutritionSnapshot.kcal ?? 0, store.settings.locale) }}</strong>
          <button class="danger" @click="store.deleteDiaryEntry(entry.id)">Delete</button>
        </div>
      </div>
      <div v-for="key in ['proteinG', 'carbsG', 'fatG'] as const" :key="key" class="row">
        <span>{{ nutritionLabels[key] }}</span>
        <strong>{{ formatNumber(dayNutrition[key] ?? 0, store.settings.locale, 1) }} g</strong>
      </div>
    </section>
  </div>
</template>
