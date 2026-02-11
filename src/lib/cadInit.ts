/**
 * Asynchronous OpenCascade WASM loader — singleton pattern.
 * Provides a single shared OCCT instance across the application.
 */

import initOpenCascade from "opencascade.js";
import type { OpenCascadeInstance } from "opencascade.js/dist/opencascade.full";

export type { OpenCascadeInstance };

let _oc: OpenCascadeInstance | null = null;
let _initPromise: Promise<OpenCascadeInstance> | null = null;

/**
 * Initialize the OpenCascade WASM module (singleton).
 * First call triggers the download (~30MB), subsequent calls return the cached instance.
 */
export async function initOCCT(): Promise<OpenCascadeInstance> {
  if (_oc) return _oc;
  if (_initPromise) return _initPromise;

  _initPromise = initOpenCascade().then((oc) => {
    _oc = oc;
    console.log("[CAD] OpenCascade WASM initialized");
    return oc;
  });

  return _initPromise;
}

/**
 * Get the cached OCCT instance. Throws if not yet initialized.
 */
export function getOCCT(): OpenCascadeInstance {
  if (!_oc) throw new Error("OpenCascade not initialized. Call initOCCT() first.");
  return _oc;
}

/**
 * Check if OCCT is ready.
 */
export function isOCCTReady(): boolean {
  return _oc !== null;
}
