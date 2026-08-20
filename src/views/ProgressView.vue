<script setup lang="ts">
import { computed, ref } from "vue"
import { entriesForWeek, isoDate, nutritionForEntries } from "@/domain/budget"
import { formatNumber, parseDecimalInput } from "@/domain/number"
import { nutritionForEntries as sumEntries } from "@/domain/budget"
import { changeOverDays, latestWeight, movingAverage, sortWeights } from "@/domain/weight"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const weightKg = ref("")
const weightDate = ref(isoDate())
const note = ref("")

const weights = computed(() => sortWeights(store.weightEntries))
const trend = computed(() => movingAverage(store.weightEntries))
const current = computed(() => latestWeight(store.weightEntries))
const change7 = computed(() => changeOverDays(store.weightEntries, 7))
const change30 = computed(() => changeOverDays(store.weightEntries, 30))
const weightPath = computed(() => linePath(weights.value.map((entry) => ({ x: entry.date, y: entry.kg }))))
const trendPath = computed(() => linePath(trend.value.map((entry) => ({ x: entry.date, y: entry.trendKg }))))
const lastSevenDays = computed(() => {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (6 - index))
    const day = isoDate(date)
    return { date: day, nutrition: sumEntries(store.diaryEntries.filter((entry) => entry.date === day)) }
  })
})
const thisWeekNutrition = computed(() => nutritionForEntries(entriesForWeek(store.diaryEntries, new Date(), store.settings.weekStartsOn)))

async function saveWeight() {
  const kg = parseDecimalInput(weightKg.value)
  if (kg === undefined) return
  await store.saveWeight({ date: weightDate.value, kg, note: note.value || undefined })
  weightKg.value = ""
  note.value = ""
}

function linePath(points: Array<{ x: string; y: number }>): string {
  if (points.length < 2) return ""
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const spread = maxY - minY || 1
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100
      const y = 100 - ((point.y - minY) / spread) * 86 - 7
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")
}
</script>

<template>
  <div class="stack">
    <h1>Progress</h1>
    <section class="cards">
      <article class="card">
        <h2>Current Weight</h2>
        <div class="metric">{{ current ? formatNumber(current.kg, store.settings.locale, 1) : "—" }} kg</div>
        <p class="muted">
          7 days {{ change7 !== undefined ? formatNumber(change7, store.settings.locale, 1) : "—" }} kg ·
          30 days {{ change30 !== undefined ? formatNumber(change30, store.settings.locale, 1) : "—" }} kg
        </p>
      </article>
      <article class="card">
        <h2>Goal</h2>
        <div class="metric">{{ store.settings.profile.goalWeightKg ? formatNumber(store.settings.profile.goalWeightKg, store.settings.locale, 1) : "—" }} kg</div>
        <p class="muted" v-if="current && store.settings.profile.goalWeightKg">
          {{ formatNumber(current.kg - store.settings.profile.goalWeightKg, store.settings.locale, 1) }} kg remaining
        </p>
      </article>
    </section>

    <section class="card stack">
      <h2>Log weight</h2>
      <div class="inline">
        <label>Date<input v-model="weightDate" type="date" /></label>
        <label>Weight kg<input v-model="weightKg" inputmode="decimal" /></label>
      </div>
      <label>Note<input v-model="note" /></label>
      <button class="primary" @click="saveWeight">Save weight</button>
    </section>

    <section class="card">
      <h2>Weight chart</h2>
      <svg class="chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Weight and trend chart">
        <path v-if="weightPath" :d="weightPath" fill="none" stroke="var(--accent-2)" stroke-width="2" vector-effect="non-scaling-stroke" />
        <path v-if="trendPath" :d="trendPath" fill="none" stroke="var(--accent)" stroke-width="3" vector-effect="non-scaling-stroke" />
      </svg>
      <p class="muted">Raw weight and 7-entry moving average trend.</p>
    </section>

    <section class="card">
      <h2>Nutrition charts</h2>
      <div v-for="day in lastSevenDays" :key="day.date" class="row">
        <span>{{ day.date }}</span>
        <strong>{{ formatNumber(day.nutrition.kcal ?? 0, store.settings.locale) }} kcal</strong>
      </div>
      <p class="muted">
        This week:
        {{ formatNumber(thisWeekNutrition.kcal ?? 0, store.settings.locale) }} kcal,
        {{ formatNumber(thisWeekNutrition.proteinG ?? 0, store.settings.locale, 1) }} g protein.
      </p>
    </section>
  </div>
</template>
