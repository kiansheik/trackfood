<script setup lang="ts">
import { computed } from "vue"
import { entriesForDate, isoDate, nutritionForEntries, weeklyBudgetSummary } from "@/domain/budget"
import { formatNumber } from "@/domain/number"
import { nutritionLabels } from "@/domain/nutrition"
import { changeOverDays, latestWeight, movingAverage } from "@/domain/weight"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const today = isoDate()
const todayEntries = computed(() => entriesForDate(store.diaryEntries, today))
const todayNutrition = computed(() => nutritionForEntries(todayEntries.value))
const week = computed(() => weeklyBudgetSummary(store.diaryEntries, store.settings))
const currentWeight = computed(() => latestWeight(store.weightEntries))
const weightChange30 = computed(() => changeOverDays(store.weightEntries, 30))
const trend = computed(() => {
  const values = movingAverage(store.weightEntries)
  return values[values.length - 1]?.trendKg
})

const macroRows = computed(() => [
  ["proteinG", store.settings.macroTargets.proteinG],
  ["carbsG", store.settings.macroTargets.carbsG],
  ["fatG", store.settings.macroTargets.fatG],
  ["sugarsG", undefined],
  ["fiberG", undefined],
  ["sodiumMg", undefined]
] as const)
</script>

<template>
  <div class="stack">
    <section>
      <h1>Today</h1>
      <div class="cards">
        <article class="card">
          <div class="section-title">
            <h2>Calories</h2>
            <span class="muted">{{ today }}</span>
          </div>
          <div class="metric">
            {{ formatNumber(todayNutrition.kcal ?? 0, store.settings.locale) }} / {{ formatNumber(store.settings.dailyCalorieTarget, store.settings.locale) }}
          </div>
          <p class="muted">kcal used against the normal daily target</p>
          <div class="progress" :style="{ '--value': `${((todayNutrition.kcal ?? 0) / store.settings.dailyCalorieTarget) * 100}%` }">
            <span />
          </div>
        </article>

        <article class="card">
          <div class="section-title">
            <h2>This Week</h2>
            <span class="muted">{{ week.weekStart }} to {{ week.weekEnd }}</span>
          </div>
          <div class="metric">
            {{ formatNumber(week.consumed, store.settings.locale) }} / {{ formatNumber(week.target, store.settings.locale) }}
          </div>
          <p class="muted">
            {{ formatNumber(week.remaining, store.settings.locale) }} kcal remaining.
            {{ formatNumber(week.averageAvailablePerRemainingDay, store.settings.locale) }}/day available for {{ week.remainingDays }} day(s).
          </p>
          <div class="progress" :style="{ '--value': `${(week.consumed / week.target) * 100}%` }">
            <span />
          </div>
        </article>
      </div>
    </section>

    <section class="grid two">
      <article class="card">
        <div class="section-title">
          <h2>Macros</h2>
          <RouterLink to="/settings">Targets</RouterLink>
        </div>
        <div v-for="[key, target] in macroRows" :key="key" class="row">
          <span>{{ nutritionLabels[key] }}</span>
          <strong>
            {{ formatNumber(todayNutrition[key] ?? 0, store.settings.locale, key === 'sodiumMg' ? 0 : 1) }}
            <span v-if="target">/ {{ formatNumber(target, store.settings.locale) }}</span>
            {{ key === "sodiumMg" ? "mg" : "g" }}
          </strong>
        </div>
      </article>

      <article class="card">
        <div class="section-title">
          <h2>Weight</h2>
          <RouterLink to="/progress">Progress</RouterLink>
        </div>
        <div class="metric">{{ currentWeight ? formatNumber(currentWeight.kg, store.settings.locale, 1) : "—" }} kg</div>
        <p class="muted">
          Trend {{ trend ? formatNumber(trend, store.settings.locale, 1) : "—" }} kg.
          <span v-if="weightChange30 !== undefined">{{ weightChange30 > 0 ? "+" : "" }}{{ formatNumber(weightChange30, store.settings.locale, 1) }} kg / 30 days.</span>
        </p>
        <p class="muted" v-if="store.settings.profile.goalWeightKg">
          Goal {{ formatNumber(store.settings.profile.goalWeightKg, store.settings.locale, 1) }} kg
        </p>
      </article>
    </section>

    <section class="card">
      <div class="section-title">
        <h2>Meals</h2>
        <RouterLink to="/log" class="button primary">Log food</RouterLink>
      </div>
      <div v-for="meal in store.settings.mealNames" :key="meal" class="row">
        <span>{{ meal }}</span>
        <strong>{{ formatNumber(nutritionForEntries(todayEntries.filter((entry) => entry.meal === meal)).kcal ?? 0, store.settings.locale) }} kcal</strong>
      </div>
    </section>
  </div>
</template>
