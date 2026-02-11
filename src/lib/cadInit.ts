/**
 * CAD Kernel initializer — stub.
 * OpenCascade.js WASM (~30MB) cannot be served in this environment.
 * This module provides the same API surface so the rest of the app compiles,
 * but always reports "not ready".
 */

export type OpenCascadeInstance = any;

let _oc: OpenCascadeInstance | null = null;

export async function initOCCT(): Promise<OpenCascadeInstance> {
  console.warn("[CAD] OpenCascade WASM not available in this environment");
  throw new Error("OpenCascade WASM not available");
}

export function getOCCT(): OpenCascadeInstance {
  if (!_oc) throw new Error("OpenCascade not initialized.");
  return _oc;
}

export function isOCCTReady(): boolean {
  return false;
}
