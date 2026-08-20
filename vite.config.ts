import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const base = process.env.BASE_PATH ?? "/"

export default defineConfig({
  base,
  plugins: [
    vue(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "TrackFood",
        short_name: "TrackFood",
        description: "Local-first calorie, nutrition, weight and fitness tracking.",
        theme_color: "#f7f4ed",
        background_color: "#f7f4ed",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"]
      }
    })
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
})
