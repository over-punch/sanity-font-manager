// Async font parser — decompressor globals must be set before lib-font is imported

import './setupDecompressors.js';
import { Font } from 'lib-font';

/** Maximum font file size accepted for parsing (50 MB) */
const MAX_FONT_FILE_SIZE = 50 * 1024 * 1024;

/** Parse timeout — prevents hanging if lib-font silently fails (30 seconds) */
const PARSE_TIMEOUT_MS = 30000;

/**
 * Parse a font file from an ArrayBuffer.
 * Returns a lib-font Font object with all tables accessible via font.opentype.tables.*.
 *
 * @param {ArrayBuffer} buffer - Raw font file bytes
 * @param {string} filename - Original filename (used for format detection by lib-font)
 * @returns {Promise<import('lib-font').Font>} Parsed lib-font Font object
 * @throws {Error} If the file exceeds MAX_FONT_FILE_SIZE, parsing fails, or times out
 */
export async function parseFont(buffer, filename) {
	if (buffer.byteLength > MAX_FONT_FILE_SIZE) {
		throw new Error(`Font file exceeds ${MAX_FONT_FILE_SIZE / 1024 / 1024}MB limit: ${filename} (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);
	}

	return new Promise((resolve, reject) => {
		let settled = false;

		const settle = (fn) => (...args) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				fn(...args);
			}
		};

		// Timeout guard — prevents infinite hang if lib-font fails silently
		const timer = setTimeout(() => {
			settle(reject)(new Error(`Parsing timed out for ${filename} (${PARSE_TIMEOUT_MS / 1000}s). The file may be corrupted or in an unsupported format.`));
		}, PARSE_TIMEOUT_MS);

		const font = new Font('font', { skipStyleSheet: true });
		font.onload = settle((evt) => resolve(evt.detail.font));
		font.onerror = settle((evt) => {
			const msg = evt.detail?.message || `Failed to parse ${filename}`;
			reject(new Error(msg));
		});

		try {
			font.fromDataBuffer(buffer, filename);
		} catch (err) {
			// Catches synchronous throws from WOFF2 constructor when brotli is missing
			settle(reject)(new Error(`${filename}: ${err.message}`));
		}
	});
}
