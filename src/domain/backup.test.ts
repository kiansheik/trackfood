import { describe, expect, it } from "vitest"
import { buildBackup, validateBackup } from "./backup"
import { defaultSettings } from "@/db"

describe("backup format", () => {
  it("builds and validates versioned human-readable backup data", () => {
    const backup = buildBackup({
      settings: defaultSettings(),
      foods: [],
      diaryEntries: [],
      weightEntries: []
    })
    expect(validateBackup(JSON.parse(JSON.stringify(backup))).version).toBe(1)
  })

  it("rejects unsupported backup versions", () => {
    expect(() => validateBackup({ version: 999 })).toThrow(/Versão/)
  })
})
