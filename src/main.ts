import { createApp } from "vue"
import { createPinia } from "pinia"
import { registerSW } from "virtual:pwa-register"
import App from "./App.vue"
import { router } from "./router"
import "./styles.css"

const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent("trackfood:update-ready"))
  }
})

window.addEventListener("trackfood:apply-update", () => updateSW(true))

createApp(App).use(createPinia()).use(router).mount("#app")
