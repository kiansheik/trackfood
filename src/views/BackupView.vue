<script setup lang="ts">
import { ref } from "vue"
import { useAppStore } from "@/stores/app"

const store = useAppStore()
const importText = ref("")
const status = ref("")

async function exportData() {
  const backup = await store.exportBackup()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `trackfood-backup-${backup.exportedAt.slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  status.value = "Backup exported."
}

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) importText.value = await file.text()
}

async function importData() {
  try {
    const parsed = JSON.parse(importText.value)
    await store.importBackup(parsed)
    status.value = "Backup imported."
  } catch (err) {
    status.value = err instanceof Error ? err.message : "Import failed."
  }
}

async function erase() {
  if (!confirm("Erase all local TrackFood data on this browser? Export a backup first if you need it.")) return
  await store.eraseAllData()
  status.value = "Local data erased."
}
</script>

<template>
  <div class="stack">
    <h1>Backups</h1>
    <p v-if="status" class="card">{{ status }}</p>

    <section class="card stack">
      <h2>Export</h2>
      <p class="muted">Human-readable JSON with settings, foods, serving units, diary entries, weight history and goals.</p>
      <button class="primary" @click="exportData">Export backup</button>
    </section>

    <section class="card stack">
      <h2>Import</h2>
      <label>Backup file<input type="file" accept="application/json,.json" @change="onFile" /></label>
      <label>Backup JSON<textarea v-model="importText"></textarea></label>
      <button :disabled="!importText" @click="importData">Validate and import</button>
    </section>

    <section class="card stack">
      <h2>Erase</h2>
      <p class="muted">This clears only this browser's IndexedDB data.</p>
      <button class="danger" @click="erase">Erase all local data</button>
    </section>
  </div>
</template>
