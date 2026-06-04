// Sets up globalThis.pako and globalThis.unbrotli for lib-font WOFF/WOFF2 decompression.
// Must be imported before lib-font. The unbrotli vendor UMD exports via module.exports
// in bundler environments (not globalThis), so we import the default export and set it manually.

import pako from 'pako';
import unbrotli from '../vendor/unbrotli.js';

globalThis.pako = pako;
globalThis.unbrotli = unbrotli;
