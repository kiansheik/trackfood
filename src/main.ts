import { createApp } from "vue"
import { createPinia } from "pinia"
import { registerSW } from "virtual:pwa-register"
import App from "./App.vue"
import { router } from "./router"
import "./styles.css"

// Settings can deliberately navigate to a cache-busted URL after unregistering
// a stubborn installed service worker. Once this fresh shell has actually
// loaded, remove the one-time query parameter so bookmarks remain clean.
const bootUrl = new URL(window.location.href)
if (bootUrl.searchParams.has("__trackfood_refresh")) {
  bootUrl.searchParams.delete("__trackfood_refresh")
  window.history.replaceState(window.history.state, "", bootUrl.toString())
}

const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent("trackfood:update-ready"))
  }
})

window.addEventListener("trackfood:apply-update", () => updateSW(true))

createApp(App).use(createPinia()).use(router).mount("#app")
