// Sets up globalThis.pako and globalThis.unbrotli for lib-font WOFF/WOFF2 decompression.
// This module MUST be imported before lib-font is ever evaluated.
// It runs synchronously at module evaluation time to set the globals.

import pako from 'pako';
import '../vendor/unbrotli.js';

globalThis.pako = pako;
// unbrotli.js is a UMD that sets globalThis.unbrotli as a side effect on evaluation.
// The import above triggers that side effect.
