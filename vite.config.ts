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
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // PP-OCRv6 deliberately lives behind a dynamic import. Its OpenCV/ORT
        // worker and WASM artifacts are tens of MB, so precaching them would
        // make every PWA install pay the scanner cost even if OCR is never
        // opened, and it exceeds Workbox's 2 MiB precache safety limit.
        // Fetch these pieces only when OCR is first used, then keep them. This
        // is a UX decision documented in docs/ocr-methodology.md, not a model
        // quality compromise made merely to shrink the application shell.
        globIgnores: [
          "**/worker-entry-*.js",
          "**/dist-*.js",
          "**/*.wasm"
        ],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(?:worker-entry-.*\.js|dist-.*\.js|.*\.wasm)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "trackfood-ocr-runtime-v1",
              expiration: {
                maxEntries: 8,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
})
