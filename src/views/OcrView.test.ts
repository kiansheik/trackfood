import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import OcrView from "./OcrView.vue"

type PipelineState = {
  guidance: "warming" | "ready" | "dark" | "glare" | "blurry" | "frozen"
  captured: number
  processed: number
  rejected: number
  processing: boolean
  workerReady: boolean
  lastCaptureAccepted: boolean
  region?: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
  regionSource: "searching" | "candidate" | "ocr" | "flow"
  trackingConfidence: number
}

const cameraHarness = vi.hoisted(() => ({
  readings: [] as Array<{ text: string; confidence: number }>,
  callbacks: undefined as undefined | {
    onReading: (reading: { text: string; confidence: number }) => boolean
    onStatus: (status: string) => void
    onStopped: () => void
    onPipeline?: (state: PipelineState) => void
  },
  videoElement: undefined as HTMLVideoElement | undefined,
  startCalls: 0,
  stopCalls: 0,
  captureCalls: 0,
  finishCapture: undefined as undefined | (() => void)
}))

vi.mock("@/services/manualLabelCamera", () => ({
  createManualLabelCamera: (video: HTMLVideoElement, callbacks: NonNullable<typeof cameraHarness.callbacks>) => {
    cameraHarness.videoElement = video
    cameraHarness.callbacks = callbacks
    let active = true
    let pending: { text: string; confidence: number } | undefined
    const state: PipelineState = {
      guidance: "ready",
      captured: 0,
      processed: 0,
      rejected: 0,
      processing: false,
      workerReady: false,
      lastCaptureAccepted: false,
      region: [
        { x: 0.18, y: 0.2 },
        { x: 0.78, y: 0.17 },
        { x: 0.82, y: 0.82 },
        { x: 0.2, y: 0.85 }
      ],
      regionSource: "flow",
      trackingConfidence: 0.82
    }
    const emit = () => callbacks.onPipeline?.({ ...state })

    return {
      start: async () => {
        cameraHarness.startCalls++
        state.workerReady = true
        emit()
        callbacks.onStatus("Ready. When the label looks good, tap anywhere on the viewport to take an OCR photo.")
      },
      capture: () => {
        if (!active || pending || !state.workerReady || state.processing) return false
        const next = cameraHarness.readings.shift()
        if (!next) return false
        cameraHarness.captureCalls++
        pending = next
        state.captured++
        state.processing = true
        state.lastCaptureAccepted = true
        emit()
        callbacks.onStatus(`Photo ${state.captured} captured. Reading it locally…`)
        cameraHarness.finishCapture = () => {
          if (!pending || !active) return
          const reading = pending
          pending = undefined
          const complete = callbacks.onReading(reading)
          state.processed++
          state.processing = false
          emit()
          if (complete) {
            callbacks.onStatus("The deliberate photos agree on all required 100 g/100 ml fields. Review the result before saving.")
            active = false
            callbacks.onStopped()
          } else {
            callbacks.onStatus(`Photo ${state.processed} added. Reposition the label if useful, then tap the viewport for another photo.`)
          }
          cameraHarness.finishCapture = undefined
        }
        return true
      },
      stop: () => {
        cameraHarness.stopCalls++
        if (!active) return
        active = false
        callbacks.onStopped()
      }
    }
  }
}))

function fullLabel(kcal = 400, includeSodium = true): string {
  return `Informação Nutricional
Porção: 30 g
100 g %VD
Valor energético (kcal) ${kcal} 20
Carboidratos (g) 60 20
Açúcares totais (g) 10 4
Açúcares adicionados (g) 8 16
Proteínas (g) 10 20
Gorduras totais (g) 12 18
Gorduras saturadas (g) 4 20
Gorduras trans (g) 0 0
Fibras alimentares (g) 5 20${includeSodium ? "\nSódio (mg) 100 5" : ""}`
}

async function takePhoto(wrapper: ReturnType<typeof mount>, checkProcessing = false) {
  await wrapper.get("[data-testid='capture-viewport']").trigger("click")
  await flushPromises()
  if (checkProcessing) {
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Processing")
    expect(wrapper.get("[data-testid='capture-viewport']").attributes("disabled")).toBeDefined()
    expect(wrapper.get("[data-testid='label-camera']").attributes("data-capture-state")).toBe("processing")
  }
  cameraHarness.finishCapture?.()
  await flushPromises()
}

beforeEach(() => {
  cameraHarness.readings = []
  cameraHarness.callbacks = undefined
  cameraHarness.videoElement = undefined
  cameraHarness.startCalls = 0
  cameraHarness.stopCalls = 0
  cameraHarness.captureCalls = 0
  cameraHarness.finishCapture = undefined
  sessionStorage.clear()
  window.location.hash = "#/ocr"
})

describe("manual nutrition label camera", () => {
  it("opens against the rendered video element, waits for a viewport tap, and preserves partial evidence on pause", async () => {
    cameraHarness.readings = [{ text: fullLabel(), confidence: 92 }]
    const wrapper = mount(OcrView, { attachTo: document.body })

    expect(wrapper.find("[data-testid='label-camera'] video").exists()).toBe(true)
    await wrapper.get("[data-testid='start-camera']").trigger("click")
    await flushPromises()

    expect(cameraHarness.startCalls).toBe(1)
    expect(cameraHarness.videoElement).toBeInstanceOf(HTMLVideoElement)
    expect(cameraHarness.videoElement?.id).toBe("trackfood-nutrition-camera")
    expect(cameraHarness.captureCalls).toBe(0)
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Ready")
    expect(wrapper.get("[data-testid='capture-prompt']").text()).toContain("Tap to take photo")
    expect(wrapper.get("[data-testid='capture-viewport']").attributes("disabled")).toBeUndefined()

    await takePhoto(wrapper, true)

    expect(cameraHarness.captureCalls).toBe(1)
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Ready")
    expect(wrapper.get("[data-testid='field-kcal']").attributes("data-state")).toBe("collecting")
    expect(wrapper.get("[data-testid='capture-detail']").text()).toContain("1 accepted photo")
    expect(wrapper.get("[data-testid='region-label']").text()).toContain("tracked")

    await wrapper.get("[data-testid='stop-camera']").trigger("click")
    await flushPromises()

    expect(cameraHarness.stopCalls).toBe(1)
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Paused")
    expect(wrapper.get("[data-testid='scan-status']").text()).toContain("preserved")
    expect(wrapper.get("[data-testid='start-camera']").text()).toContain("Resume")

    await wrapper.get("[data-testid='use-current-result']").trigger("click")
    await flushPromises()
    expect(window.location.hash).toBe("#/foods/new")
    expect(JSON.parse(sessionStorage.getItem("trackfood:food-draft") ?? "{}").sourceMetadata.multiFrame.captureMode).toBe("manual")

    wrapper.unmount()
  })

  it("keeps a plausible conflict visible across deliberate photos", async () => {
    cameraHarness.readings = [
      { text: fullLabel(400), confidence: 95 },
      { text: fullLabel(400), confidence: 94 },
      { text: fullLabel(380), confidence: 96 },
      { text: fullLabel(400), confidence: 93 }
    ]
    const wrapper = mount(OcrView, { attachTo: document.body })
    await wrapper.get("[data-testid='start-camera']").trigger("click")
    await flushPromises()

    for (let i = 0; i < 4; i++) await takePhoto(wrapper)

    const kcal = wrapper.get("[data-testid='field-kcal']")
    expect(kcal.attributes("data-state")).toBe("conflict")
    expect(kcal.text()).toContain("Conflict")
    expect(kcal.text()).toContain("400 (3)")
    expect(kcal.text()).toContain("380 (1)")
    expect((wrapper.get("[data-testid='overall-progress']").element as HTMLProgressElement).value).toBe(10)
    expect(wrapper.get("[data-testid='hud-pending']").text()).toContain("Recheck")
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Ready")

    wrapper.unmount()
  })

  it("auto-closes after three deliberate clean photos", async () => {
    cameraHarness.readings = Array.from({ length: 3 }, () => ({ text: fullLabel(), confidence: 94 }))
    const wrapper = mount(OcrView, { attachTo: document.body })
    await wrapper.get("[data-testid='start-camera']").trigger("click")
    await flushPromises()

    for (let i = 0; i < 3; i++) await takePhoto(wrapper)

    expect(cameraHarness.captureCalls).toBe(3)
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Complete")
    expect(wrapper.get("[data-testid='scan-complete']").text()).toContain("deliberate photos")
    expect(wrapper.get("[data-testid='scan-status']").text()).toContain("deliberate photos agree")
    expect((wrapper.get("[data-testid='overall-progress']").element as HTMLProgressElement).value).toBe(11)
    expect(wrapper.get("[data-testid='capture-viewport']").attributes("disabled")).toBeDefined()

    wrapper.unmount()
  })

  it("recommends manual entry instead of another photo when only one field remains", async () => {
    cameraHarness.readings = Array.from({ length: 3 }, () => ({ text: fullLabel(400, false), confidence: 95 }))
    const wrapper = mount(OcrView, { attachTo: document.body })
    await wrapper.get("[data-testid='start-camera']").trigger("click")
    await flushPromises()

    for (let i = 0; i < 3; i++) await takePhoto(wrapper)

    const suggestion = wrapper.get("[data-testid='finish-manually-suggestion']")
    expect(suggestion.text()).toContain("Sódio")
    expect(suggestion.text()).toContain("type that field yourself")
    expect(wrapper.get("[data-testid='use-current-result']").text()).toContain("Sódio")
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Ready")

    await wrapper.get("[data-testid='use-current-result']").trigger("click")
    await flushPromises()
    expect(window.location.hash).toBe("#/foods/new")

    wrapper.unmount()
  })
})