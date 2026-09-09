import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import OcrView from "./OcrView.vue"

const routerPush = vi.hoisted(() => vi.fn())
const cameraHarness = vi.hoisted(() => ({
  readings: [] as Array<{ text: string; confidence: number }>,
  callbacks: undefined as undefined | {
    onReading: (reading: { text: string; confidence: number }) => boolean
    onStatus: (status: string) => void
    onStopped: () => void
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
        callbacks.onStatus("Reading… keep the table and column headings inside the frame.")
        for (const reading of cameraHarness.readings) {
          if (!active) return
          const complete = callbacks.onReading(reading)
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
  it("renders the live camera preview and keeps a partial composite when the user cancels", async () => {
    cameraHarness.readings = [{ text: fullLabel(), confidence: 92 }]
    const wrapper = mount(OcrView)

    expect(wrapper.find("[data-testid='label-camera'] video").exists()).toBe(true)
    await wrapper.get("[data-testid='start-camera']").trigger("click")
    await flushPromises()

    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Scanning")
    expect(wrapper.get("[data-testid='field-kcal']").attributes("data-state")).toBe("collecting")

    await wrapper.get("[data-testid='stop-camera']").trigger("click")
    await flushPromises()

    expect(cameraHarness.stopCalls).toBe(1)
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Paused")
    expect(wrapper.get("[data-testid='scan-status']").text()).toContain("Camera stopped")
    expect(wrapper.find("[data-testid='field-kcal']").exists()).toBe(true)
    expect(wrapper.get("[data-testid='start-camera']").attributes("disabled")).toBeUndefined()

    wrapper.unmount()
  })

  it("shows contradictory readings as a conflict instead of averaging or confirming them", async () => {
    cameraHarness.readings = [
      { text: fullLabel(400), confidence: 95 },
      { text: fullLabel(400), confidence: 94 },
      { text: fullLabel(400), confidence: 93 },
      { text: fullLabel(40), confidence: 96 }
    ]
    const wrapper = mount(OcrView)

    await wrapper.get("[data-testid='start-camera']").trigger("click")
    await flushPromises()

    const kcal = wrapper.get("[data-testid='field-kcal']")
    expect(kcal.attributes("data-state")).toBe("conflict")
    expect(kcal.text()).toContain("Conflict")
    expect(kcal.text()).toContain("400 (3)")
    expect(kcal.text()).toContain("40 (1)")
    expect((wrapper.get("[data-testid='overall-progress']").element as HTMLProgressElement).value).toBe(10)
    expect(wrapper.get("[data-testid='scan-state']").text()).toBe("Scanning")

    wrapper.unmount()
  })

  it("returns ready on stable repeated readings and reflects the camera's automatic stop", async () => {
    cameraHarness.readings = Array.from({ length: 4 }, () => ({ text: fullLabel(), confidence: 94 }))
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
    expect(wrapper.get("[data-testid='stop-camera']").attributes("disabled")).toBeDefined()
    expect(wrapper.get("[data-testid='start-camera']").attributes("disabled")).toBeUndefined()

    wrapper.unmount()
  })
})
