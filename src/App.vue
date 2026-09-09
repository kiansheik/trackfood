<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from "vue"
import { RouterLink, RouterView } from "vue-router"
import { OCR_STARTUP_EVENT, type OcrStartupProgress } from "@/services/ocrStartup"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const updateReady = ref(false)
const ocrStartup = ref<OcrStartupProgress>()
let startupHideTimer: ReturnType<typeof setTimeout> | undefined

const dark = computed(() => {
  if (store.settings.theme === "dark") return true
  if (store.settings.theme === "light") return false
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
})

const startupEta = computed(() => {
  const etaMs = ocrStartup.value?.etaMs
  if (!etaMs || etaMs <= 0) return ""
  const seconds = Math.max(1, Math.ceil(etaMs / 1000))
  if (seconds >= 90) return `about ${Math.ceil(seconds / 60)} min remaining`
  return `about ${seconds} sec remaining`
})

function onUpdateReady() {
  updateReady.value = true
}

function onOcrStartup(event: Event) {
  const detail = (event as CustomEvent<OcrStartupProgress>).detail
  if (!detail) return
  if (startupHideTimer) clearTimeout(startupHideTimer)
  ocrStartup.value = detail
  if (detail.stage === "ready") {
    startupHideTimer = setTimeout(() => {
      if (ocrStartup.value?.stage === "ready") ocrStartup.value = undefined
    }, 1200)
  }
}

onMounted(() => {
  void store.load()
  window.addEventListener("trackfood:update-ready", onUpdateReady)
  window.addEventListener(OCR_STARTUP_EVENT, onOcrStartup)
})

onBeforeUnmount(() => {
  window.removeEventListener("trackfood:update-ready", onUpdateReady)
  window.removeEventListener(OCR_STARTUP_EVENT, onOcrStartup)
  if (startupHideTimer) clearTimeout(startupHideTimer)
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

    <div
      v-if="ocrStartup"
      class="ocr-startup-banner"
      :class="{ 'with-update': updateReady }"
      data-testid="ocr-startup-progress"
      role="status"
      aria-live="polite"
    >
      <div class="ocr-startup-heading">
        <strong>{{ ocrStartup.message }}</strong>
        <span>{{ Math.round(ocrStartup.percent) }}%</span>
      </div>
      <div class="progress" aria-hidden="true">
        <span :style="{ '--value': `${ocrStartup.percent}%` }"></span>
      </div>
      <small v-if="startupEta">{{ startupEta }} · ETA adjusts to this device after successful loads.</small>
      <small v-else-if="ocrStartup.stage !== 'ready'">Trying phone-native OCR first; the large browser model loads only if needed.</small>
    </div>

    <div v-if="updateReady" class="update-banner">
      <span>Update ready.</span>
      <button class="button primary" @click="applyUpdate">Reload</button>
    </div>
  </div>
</template>

<style scoped>
.ocr-startup-banner {
  position: fixed;
  left: 1rem;
  right: 1rem;
  bottom: 82px;
  z-index: 9;
  display: grid;
  gap: 0.45rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  padding: 0.8rem;
  box-shadow: var(--shadow);
}
.ocr-startup-banner.with-update { bottom: 154px; }
.ocr-startup-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.ocr-startup-banner small { color: var(--muted); }
@media (min-width: 760px) {
  .ocr-startup-banner {
    width: min(540px, calc(100% - 2rem));
    left: auto;
  }
}
</style>
