/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] })
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>>
  static getSupportedFormats?: () => Promise<string[]>
}
