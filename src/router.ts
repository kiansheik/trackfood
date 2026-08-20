import { createRouter, createWebHashHistory } from "vue-router"
import DashboardView from "@/views/DashboardView.vue"
import FoodsView from "@/views/FoodsView.vue"
import FoodEditorView from "@/views/FoodEditorView.vue"
import LogView from "@/views/LogView.vue"
import ScanView from "@/views/ScanView.vue"
import OcrView from "@/views/OcrView.vue"
import ProgressView from "@/views/ProgressView.vue"
import SettingsView from "@/views/SettingsView.vue"
import BackupView from "@/views/BackupView.vue"

export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", name: "dashboard", component: DashboardView },
    { path: "/foods", name: "foods", component: FoodsView },
    { path: "/foods/new", name: "food-new", component: FoodEditorView },
    { path: "/foods/:id", name: "food-edit", component: FoodEditorView },
    { path: "/log/:foodId?", name: "log", component: LogView },
    { path: "/scan", name: "scan", component: ScanView },
    { path: "/ocr", name: "ocr", component: OcrView },
    { path: "/progress", name: "progress", component: ProgressView },
    { path: "/settings", name: "settings", component: SettingsView },
    { path: "/backup", name: "backup", component: BackupView }
  ]
})
