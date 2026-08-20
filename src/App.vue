<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from "vue"
import { RouterLink, RouterView } from "vue-router"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const updateReady = ref(false)
const dark = computed(() => {
  if (store.settings.theme === "dark") return true
  if (store.settings.theme === "light") return false
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
})

onMounted(() => {
  void store.load()
  window.addEventListener("trackfood:update-ready", () => {
    updateReady.value = true
  })
})

watchEffect(() => {
  document.documentElement.dataset.theme = dark.value ? "dark" : "light"
})

function applyUpdate() {
  window.dispatchEvent(new CustomEvent("trackfood:apply-update"))
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <RouterLink to="/" class="brand" aria-label="TrackFood dashboard">
        <span class="brand-mark">TF</span>
        <span>TrackFood</span>
      </RouterLink>
      <div class="top-actions">
        <RouterLink to="/scan" class="button primary">Scan</RouterLink>
        <RouterLink to="/foods/new" class="button">Add Food</RouterLink>
      </div>
    </header>

    <main class="main">
      <p v-if="!store.ready" class="muted">Loading local data...</p>
      <RouterView v-else />
    </main>

    <nav class="tabbar" aria-label="Primary">
      <RouterLink to="/">Today</RouterLink>
      <RouterLink to="/log">Log</RouterLink>
      <RouterLink to="/foods">Foods</RouterLink>
      <RouterLink to="/progress">Progress</RouterLink>
      <RouterLink to="/settings">Settings</RouterLink>
    </nav>

    <div v-if="updateReady" class="update-banner">
      <span>Update ready.</span>
      <button class="button primary" @click="applyUpdate">Reload</button>
    </div>
  </div>
</template>
