import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "io.kiansheik.trackfood",
  appName: "TrackFood",
  webDir: "dist",
  server: {
    androidScheme: "https"
  }
}

export default config
