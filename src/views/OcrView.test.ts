import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import OcrView from "./OcrView.vue"

const routerPush = vi.hoisted(() => vi.fn())
type PipelineState = {
  guidance: "warming" | "ready" | "dark" | "glare" | "blurry" | "frozen"
  queued: number
  captured: number
  processed: number
  dropped: number
  processing: boolean
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
  startCalls: 0,
  stopCalls: 0
}))

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush })
}))

vi.mock("@/services/labelCamera", () => ({
  LABEL_CROP: { x: 0.05, y: 0.1, width: 0.9, height: 0.8 },
  createLabelCamera: (_video: HTMLVideoElement, callbacks: NonNullable<typeof cameraHarness.callbacks>) => {
    cameraHarness.callbacks = callbacks
    let active = true
    return {
      start: async () => {
        cameraHarness.startCalls++
        callbacks.onStatus("OCR is running. Follow the solid viewfinder cue.")
        for (let index = 0; index < cameraHarness.readings.length; index++) {
          if (!active) return
          callbacks.onPipeline?.({
            guidance: "ready",
            queued: Math.min(2, cameraHarness.readings.length - index - 1),
            captured: index + 1,
            processed: index,
            dropped: 0,
            processing: true,
            lastCaptureAccepted: true,
            region: [
              { x: 0.18, y: 0.2 },
              { x: 0.78, y: 0.17 },
              { x: 0.82, y: 0.82 },
              { x: 0.2, y: 0.85 }
            ],
            regionSource: "flow",
            trackingConfidence: 0.82
          })
          const complete = callbacks.onReading(cameraHarness.readings[index])
          if (complete) {
            callbacks.onStatus("Repeated readings agree. Review the composite before saving.")
            active = false
            callbacks.onStopped()
            return
          }
        }
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

function fullLabel(kcal = 400): string {
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
Fibras alimentares (g) 5 20
Sódio (mg) 100 5`
}

beforeEach(() => {
  cameraHarness.readings = []
  cameraHarness.callbacks = undefined
  cameraHarness.startCalls = 0
  cameraHarness.stopCalls = 0
  routerPush.mockReset()
  sessionStorage.clear()
})

describe("live nutrition label screen", () => {
  it("shows a calm tracked-region HUD, preserves partial fields on pause, and can hand them to food review", async () => {
    cameraHarness.readings = [{ text: fullLabel(), confidence: 92 }]
    const wrapper = mount(OcrView)

    expect(wrapper.find("[data-testid='label-camera'] video").exists()).toBe(true)
    expect(wrapper.find("[data-testid='camera-progress-frame']").exists()).toBe(true)
    await wrapper.get("[data-testid='start-camera']").trigger("click")
    await flushPromises()

    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Scanning")
    expect(wrapper.get("[data-testid='field-kcal']").attributes("data-state")).toBe("collecting")
    expect(wrapper.get("[data-testid='hud-fields']").findAll(".hud-dot")).toHaveLength(11)
    expect(wrapper.get("[data-testid='hud-guidance']").text()).toContain("Got it")
    expect(wrapper.get("[data-testid='region-label']").text()).toContain("tracked")
    expect(wrapper.find("[data-testid='tracked-region']").exists()).toBe(true)
    expect(wrapper.find(".capture-flash").exists()).toBe(false)
    expect(wrapper.get("[data-testid='camera-progress-frame']").attributes("data-tone")).toBe("good")

    await wrapper.get("[data-testid='stop-camera']").trigger("click")
    await flushPromises()

    expect(cameraHarness.stopCalls).toBe(1)
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Paused")
    expect(wrapper.get("[data-testid='scan-status']").text()).toContain("Paused")
    expect(wrapper.find("[data-testid='field-kcal']").exists()).toBe(true)
    expect(wrapper.get("[data-testid='start-camera']").text()).toContain("Continue")

    await wrapper.get("[data-testid='use-current-result']").trigger("click")
    await flushPromises()
    expect(routerPush).toHaveBeenCalledWith("/foods/new")
    expect(JSON.parse(sessionStorage.getItem("trackfood:food-draft") ?? "{}").source).toBe("label-ocr")

    wrapper.unmount()
  })

  it("shows a plausible contradiction in both the detailed fields and the camera HUD", async () => {
    // 380 and 400 kcal are both physically compatible with the other macros,
    // so the plausibility layer must not hide this genuine OCR contradiction.
    cameraHarness.readings = [
      { text: fullLabel(400), confidence: 95 },
      { text: fullLabel(400), confidence: 94 },
      { text: fullLabel(400), confidence: 93 },
      { text: fullLabel(380), confidence: 96 }
    ]
    const wrapper = mount(OcrView)

    await wrapper.get("[data-testid='start-camera']").trigger("click")
    await flushPromises()

    const kcal = wrapper.get("[data-testid='field-kcal']")
    expect(kcal.attributes("data-state")).toBe("conflict")
    expect(kcal.text()).toContain("Conflict")
    expect(kcal.text()).toContain("400 (3)")
    expect(kcal.text()).toContain("380 (1)")
    expect((wrapper.get("[data-testid='overall-progress']").element as HTMLProgressElement).value).toBe(10)
    expect(wrapper.get("[data-testid='hud-pending']").text()).toContain("Recheck")
    expect(wrapper.get("[data-testid='hud-fields']").findAll("[data-state='conflict']")).toHaveLength(1)
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Scanning")

    wrapper.unmount()
  })

  it("returns ready on stable repeated readings and reflects the camera's automatic stop", async () => {
    cameraHarness.readings = Array.from({ length: 3 }, () => ({ text: fullLabel(), confidence: 94 }))
    const wrapper = mount(OcrView)

    await wrapper.get("[data-testid='start-camera']").trigger("click")
    await flushPromises()

    expect(cameraHarness.startCalls).toBe(1)
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Complete")
    expect(wrapper.get("[data-testid='scan-complete']").text()).toContain("camera stops automatically")
    expect(wrapper.get("[data-testid='scan-status']").text()).toContain("Repeated readings agree")
    expect((wrapper.get("[data-testid='overall-progress']").element as HTMLProgressElement).value).toBe(11)
    expect((wrapper.get("[data-testid='overall-progress']").element as HTMLProgressElement).max).toBe(11)
    expect(wrapper.get("[data-testid='field-kcal']").attributes("data-state")).toBe("confirmed")
    expect(wrapper.get("[data-testid='hud-pending']").text()).toContain("All per-100 fields confirmed")
    expect(wrapper.get("[data-testid='stop-camera']").attributes("disabled")).toBeDefined()
    expect(wrapper.get("[data-testid='start-camera']").attributes("disabled")).toBeUndefined()

    wrapper.unmount()
  })
})
