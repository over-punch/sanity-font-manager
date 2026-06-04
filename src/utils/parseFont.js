// Async font parser — wraps lib-font event model in a Promise with decompressor bootstrap

// Lazy-loaded lib-font Font constructor — resolved on first parseFont() call.
// All decompressor globals (pako for WOFF, unbrotli for WOFF2) are set dynamically
// inside getFont() BEFORE lib-font is imported, guaranteeing correct evaluation order
// regardless of how the bundler (tsup/esbuild/vite) reorders static imports.
let _Font = null;

/** Returns the lib-font Font constructor, bootstrapping decompressors on first call */
async function getFont() {
	if (!_Font) {
		// Set pako (zlib) for WOFF decompression
		const pako = await import('pako');
		globalThis.pako = pako.default || pako;

		// Set unbrotli for WOFF2 decompression — UMD side-effect sets globalThis.unbrotli
		await import('../vendor/unbrotli.js');

		// NOW safe to import lib-font — both globals are set
		const mod = await import('lib-font');
		_Font = mod.Font;
	}
	return _Font;
}

/** Maximum font file size accepted for parsing (50 MB) */
const MAX_FONT_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Parse a font file from an ArrayBuffer.
 * Returns a lib-font Font object with all tables accessible via font.opentype.tables.*.
 *
 * @param {ArrayBuffer} buffer - Raw font file bytes
 * @param {string} filename - Original filename (used for format detection by lib-font)
 * @returns {Promise<import('lib-font').Font>} Parsed lib-font Font object
 * @throws {Error} If the file exceeds MAX_FONT_FILE_SIZE or parsing fails
 */
export async function parseFont(buffer, filename) {
	if (buffer.byteLength > MAX_FONT_FILE_SIZE) {
		throw new Error(`Font file exceeds ${MAX_FONT_FILE_SIZE / 1024 / 1024}MB limit: ${filename} (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);
	}

	const Font = await getFont();

	return new Promise((resolve, reject) => {
		const font = new Font('font', { skipStyleSheet: true });
		font.onload = (evt) => resolve(evt.detail.font);
		font.onerror = (evt) => reject(new Error(evt.detail?.message || `Failed to parse ${filename}`));
		font.fromDataBuffer(buffer, filename);
	});
}
