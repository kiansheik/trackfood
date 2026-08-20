<script setup lang="ts">
import { computed, reactive, watchEffect } from "vue"
import { estimateTdee } from "@/domain/metabolism"
import { formatNumber, parseDecimalInput } from "@/domain/number"
import type { AppSettings } from "@/domain/types"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const form = reactive(JSON.parse(JSON.stringify(store.settings)) as AppSettings)
const tdee = computed(() => estimateTdee(form.profile))

watchEffect(() => {
  form.weeklyCalorieTarget = form.calorieTargetMode === "daily" ? (parseDecimalInput(form.dailyCalorieTarget) ?? 0) * 7 : form.weeklyCalorieTarget
  form.macroTargets.kcal = form.dailyCalorieTarget
})

async function save() {
  await store.saveSettings(JSON.parse(JSON.stringify(form)))
}

async function requestNotifications() {
  if (!("Notification" in window)) return
  await Notification.requestPermission()
}
</script>

<template>
  <form class="stack" @submit.prevent="save">
    <div class="section-title">
      <h1>Settings</h1>
      <button class="primary" type="submit">Save</button>
    </div>

    <section class="card stack">
      <h2>Targets</h2>
      <div class="inline">
        <label>
          Calorie mode
          <select v-model="form.calorieTargetMode">
            <option value="daily">Daily target</option>
            <option value="weekly">Weekly target</option>
          </select>
        </label>
        <label>Week starts on
          <select v-model.number="form.weekStartsOn">
            <option :value="1">Monday</option>
            <option :value="0">Sunday</option>
          </select>
        </label>
      </div>
      <div class="inline">
        <label>Daily kcal<input v-model.number="form.dailyCalorieTarget" inputmode="decimal" /></label>
        <label>Weekly kcal<input v-model.number="form.weeklyCalorieTarget" inputmode="decimal" /></label>
      </div>
      <div class="three">
        <label>Protein g<input v-model.number="form.macroTargets.proteinG" inputmode="decimal" /></label>
        <label>Carbs g<input v-model.number="form.macroTargets.carbsG" inputmode="decimal" /></label>
        <label>Fat g<input v-model.number="form.macroTargets.fatG" inputmode="decimal" /></label>
      </div>
    </section>

    <section class="card stack">
      <h2>Profile</h2>
      <div class="form-grid">
        <label>Current weight kg<input v-model.number="form.profile.currentWeightKg" inputmode="decimal" /></label>
        <label>Goal weight kg<input v-model.number="form.profile.goalWeightKg" inputmode="decimal" /></label>
        <label>Height cm<input v-model.number="form.profile.heightCm" inputmode="decimal" /></label>
        <label>Date of birth<input v-model="form.profile.birthDate" type="date" /></label>
        <label>Age<input v-model.number="form.profile.age" inputmode="numeric" /></label>
        <label>
          Biological sex
          <select v-model="form.profile.sex">
            <option :value="undefined">Not set</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
        <label>
          Activity
          <select v-model="form.profile.activityLevel">
            <option value="sedentary">Sedentary</option>
            <option value="light">Light</option>
            <option value="moderate">Moderate</option>
            <option value="active">Active</option>
            <option value="very-active">Very active</option>
          </select>
        </label>
        <label>Manual TDEE<input v-model.number="form.profile.manualTdee" inputmode="decimal" /></label>
        <label>Desired change kg/week<input v-model.number="form.profile.desiredWeightChangeKgPerWeek" inputmode="decimal" /></label>
      </div>
      <p class="muted">
        Estimated TDEE:
        {{ tdee.tdee ? formatNumber(tdee.tdee, form.locale) : "missing inputs" }}
        <span v-if="tdee.bmr"> · BMR {{ formatNumber(tdee.bmr, form.locale) }}</span>
      </p>
    </section>

    <section class="card stack">
      <h2>App</h2>
      <div class="inline">
        <label>
          Locale
          <select v-model="form.locale">
            <option value="pt-BR">pt-BR</option>
            <option value="en-US">en-US</option>
          </select>
        </label>
        <label>
          Theme
          <select v-model="form.theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
      <label>
        Meal names, one per line
        <textarea :value="form.mealNames.join('\n')" @input="form.mealNames = ($event.target as HTMLTextAreaElement).value.split('\n').filter(Boolean)"></textarea>
      </label>
    </section>

    <section class="card stack">
      <div class="section-title">
        <h2>Reminders</h2>
        <button type="button" @click="requestNotifications">Enable browser permission</button>
      </div>
      <div v-for="reminder in form.reminders" :key="reminder.id" class="row">
        <label><input v-model="reminder.enabled" type="checkbox" /> {{ reminder.label }}</label>
        <input v-model="reminder.time" type="time" />
      </div>
      <p class="muted">Static PWAs cannot guarantee exact closed-app notifications on every browser. These preferences power in-app and opportunistic browser reminders.</p>
    </section>

    <RouterLink class="button" to="/backup">Backup, import and erase data</RouterLink>
  </form>
</template>
