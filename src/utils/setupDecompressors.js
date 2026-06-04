// Sets up globalThis.pako and globalThis.unbrotli for lib-font WOFF/WOFF2 decompression.
// Must be imported before lib-font.

import pako from 'pako';

// Set pako for WOFF (zlib) decompression
globalThis.pako = pako;

// Set unbrotli for WOFF2 (brotli) decompression
// The vendor unbrotli.js UMD sets globalThis.unbrotli in browser contexts.
// In Node/bundler contexts it exports via module.exports instead.
// We use a side-effect import and then check if the global was set.
import '../vendor/unbrotli.js';

// If the UMD didn't set the global (CJS path in Node/bundler), try to require it
if (!globalThis.unbrotli) {
	try {
		// In bundler context, the UMD file's module.exports is available
		// tsup will resolve this at build time
		const brotli = require('../vendor/unbrotli.js');
		if (typeof brotli === 'function') {
			globalThis.unbrotli = brotli;
		}
	} catch {
		// Silently fail — WOFF2 parsing will error gracefully
	}
}
