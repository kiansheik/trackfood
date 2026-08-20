import js from "@eslint/js"
import vue from "eslint-plugin-vue"
import tseslint from "typescript-eslint"

export default [
  {
    ignores: ["dist", "node_modules", "coverage"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/essential"],
  {
    files: ["src/**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".vue"]
      }
    },
    rules: {
      "vue/multi-word-component-names": "off"
    }
  },
  {
    files: ["src/**/*.ts", "src/**/*.vue", "*.ts"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        sessionStorage: "readonly",
        localStorage: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        Blob: "readonly",
        URL: "readonly",
        HTMLInputElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLVideoElement: "readonly",
        MediaStream: "readonly",
        CanvasImageSource: "readonly",
        BarcodeDetector: "readonly",
        Notification: "readonly",
        confirm: "readonly",
        CustomEvent: "readonly",
        setTimeout: "readonly"
      }
    }
  }
]
