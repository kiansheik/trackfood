<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue"
import { useRouter } from "vue-router"
import { lookupOpenFoodFacts } from "@/domain/openFoodFacts"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const router = useRouter()
const video = ref<HTMLVideoElement>()
const manualBarcode = ref("")
const status = ref("Camera not started.")
const scanning = ref(false)
let stream: MediaStream | undefined
let stopNative = false
let zxingControls: { stop?: () => void } | undefined

onBeforeUnmount(stopCamera)

async function startScan() {
  status.value = "Requesting camera..."
  scanning.value = true
  stopNative = false
  try {
    if ("BarcodeDetector" in window) {
      await startNative()
    } else {
      await startZxing()
    }
  } catch (err) {
    status.value = err instanceof Error ? err.message : "Camera unavailable."
    scanning.value = false
    stopCamera()
  }
}

async function startNative() {
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } })
  if (!video.value) return
  video.value.srcObject = stream
  await video.value.play()
  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] })
  status.value = "Scanning with native BarcodeDetector..."
  while (!stopNative && video.value) {
    const codes = await detector.detect(video.value)
    if (codes[0]?.rawValue) {
      await handleBarcode(codes[0].rawValue)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function startZxing() {
  const { BrowserMultiFormatReader } = await import("@zxing/browser")
  const reader = new BrowserMultiFormatReader()
  status.value = "Scanning with ZXing fallback..."
  const result = await reader.decodeOnceFromVideoDevice(undefined, video.value!)
  await handleBarcode(result.getText())
}

async function handleBarcode(barcode: string) {
  stopCamera()
  status.value = `Scanned ${barcode}. Checking local foods...`
  const local = store.foodByBarcode(barcode)
  if (local) {
    await router.push(`/log/${local.id}`)
    return
  }
  status.value = "No local food. Looking up Open Food Facts..."
  try {
    const draft = await lookupOpenFoodFacts(barcode)
    if (draft) {
      sessionStorage.setItem("trackfood:food-draft", JSON.stringify(draft))
      await router.push("/foods/new")
      return
    }
    status.value = "No Open Food Facts match. Create it manually."
    manualBarcode.value = barcode
  } catch (err) {
    status.value = err instanceof Error ? err.message : "Open Food Facts failed. Local use is still available."
    manualBarcode.value = barcode
  }
}

function stopCamera() {
  stopNative = true
  scanning.value = false
  zxingControls?.stop?.()
  stream?.getTracks().forEach((track) => track.stop())
  stream = undefined
}

function createManual() {
  void router.push({ path: "/foods/new", query: manualBarcode.value ? { barcode: manualBarcode.value } : undefined })
}
</script>

<template>
  <div class="stack">
    <h1>Scan Barcode</h1>
    <video ref="video" class="video" muted playsinline aria-label="Camera preview"></video>
    <p class="muted">{{ status }}</p>
    <div class="actions">
      <button class="primary" :disabled="scanning" @click="startScan">Scan</button>
      <button :disabled="!scanning" @click="stopCamera">Stop</button>
      <RouterLink class="button" to="/ocr">Photo label</RouterLink>
    </div>
    <section class="card stack">
      <h2>Manual fallback</h2>
      <label>Barcode<input v-model="manualBarcode" inputmode="numeric" /></label>
      <div class="actions">
        <button @click="manualBarcode && handleBarcode(manualBarcode)">Search barcode</button>
        <button @click="createManual">Create food manually</button>
      </div>
    </section>
  </div>
</template>
