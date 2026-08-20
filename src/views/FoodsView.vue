<script setup lang="ts">
import { computed, ref } from "vue"
import { RouterLink } from "vue-router"
import { gramsPerUnit, mlPerUnit } from "@/domain/nutrition"
import { formatNumber } from "@/domain/number"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const query = ref("")
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return store.foods
  return store.foods.filter((food) =>
    [food.name, food.brand, food.barcode].filter(Boolean).some((value) => value!.toLowerCase().includes(needle))
  )
})
</script>

<template>
  <div class="stack">
    <div class="section-title">
      <h1>Foods</h1>
      <RouterLink to="/foods/new" class="button primary">Add Food</RouterLink>
    </div>
    <label>
      Search
      <input v-model="query" type="search" placeholder="Name, brand or barcode" />
    </label>
    <section class="grid">
      <article v-for="food in filtered" :key="food.id" class="card">
        <div class="section-title">
          <div>
            <h3>{{ food.name }}</h3>
            <p class="muted">{{ food.brand || "Manual/local" }} <span v-if="food.barcode"> · {{ food.barcode }}</span></p>
          </div>
          <RouterLink :to="`/log/${food.id}`" class="button primary">Log</RouterLink>
        </div>
        <p class="muted">
          Basis:
          <span v-if="food.nutritionBasis.type === 'mass'">{{ food.nutritionBasis.grams }} g</span>
          <span v-else>{{ food.nutritionBasis.ml }} ml</span>
          · {{ food.nutrition.kcal ?? "—" }} kcal
        </p>
        <div class="pill-list">
          <span v-for="unit in food.servingUnits" :key="unit.id" class="pill">
            1 {{ unit.singular }} =
            <template v-if="gramsPerUnit(unit)">{{ formatNumber(gramsPerUnit(unit), store.settings.locale, 2) }} g</template>
            <template v-else>{{ formatNumber(mlPerUnit(unit), store.settings.locale, 2) }} ml</template>
          </span>
        </div>
        <div class="actions" style="margin-top: 0.75rem">
          <RouterLink :to="`/foods/${food.id}`" class="button">Edit</RouterLink>
        </div>
      </article>
      <p v-if="!filtered.length" class="muted">No foods yet.</p>
    </section>
  </div>
</template>
