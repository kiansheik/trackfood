<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue"

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ "update:modelValue": [value: string] }>()

const video = ref<HTMLVideoElement>()
const scanning = ref(false)
const status = ref("")
let stream: MediaStream | undefined
let cancelled = false

function setValue(value: string) {
  emit("update:modelValue", value.trim())
}

function stop() {
  cancelled = true
  scanning.value = false
  stream?.getTracks().forEach((track) => track.stop())
  stream = undefined
  if (video.value) video.value.srcObject = null
}

async function start() {
  if (scanning.value) return
  cancelled = false
  scanning.value = true
  status.value = "Point the camera at the product barcode."
  try {
    if ("BarcodeDetector" in window) await scanNative()
    else await scanZxing()
  } catch (error) {
    if (!cancelled) status.value = error instanceof Error ? error.message : "Barcode camera unavailable. Enter the number manually."
    scanning.value = false
  }
}

async function scanNative() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } })
  if (cancelled || !video.value) {
    stream.getTracks().forEach((track) => track.stop())
    return
  }
  video.value.srcObject = stream
  await video.value.play()
  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] })
  while (!cancelled && video.value) {
    const codes = await detector.detect(video.value)
    if (codes[0]?.rawValue) {
      setValue(codes[0].rawValue)
      status.value = `Barcode ${codes[0].rawValue} captured.`
      stop()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 180))
  }
}

async function scanZxing() {
  const { BrowserMultiFormatReader } = await import("@zxing/browser")
  const reader = new BrowserMultiFormatReader()
  const result = await reader.decodeOnceFromVideoDevice(undefined, video.value!)
  if (cancelled) return
  setValue(result.getText())
  status.value = `Barcode ${result.getText()} captured.`
  stop()
}

onBeforeUnmount(stop)
</script>

<template>
  <div class="barcode-control">
    <div class="barcode-row">
      <input
        :value="props.modelValue"
        inputmode="numeric"
        autocomplete="off"
        placeholder="EAN / UPC"
        aria-label="Barcode"
        @input="setValue(($event.target as HTMLInputElement).value)"
      />
      <button type="button" :disabled="scanning" @click="start">Scan barcode</button>
    </div>
    <div v-show="scanning" class="barcode-camera">
      <video ref="video" muted playsinline aria-label="Barcode camera preview"></video>
      <button type="button" @click="stop">Stop</button>
    </div>
    <small v-if="status" class="muted" role="status">{{ status }}</small>
  </div>
</template>

<style scoped>
.barcode-control { display: grid; gap: 0.45rem; }
.barcode-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.5rem; align-items: end; }
.barcode-camera { position: relative; overflow: hidden; border-radius: 8px; background: #000; min-height: 150px; }
.barcode-camera video { width: 100%; min-height: 150px; display: block; object-fit: cover; }
.barcode-camera button { position: absolute; right: 0.6rem; bottom: 0.6rem; }
@media (max-width: 520px) { .barcode-row { grid-template-columns: 1fr; } }
</style>
