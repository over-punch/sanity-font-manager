import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('parseFont browser decompressor setup', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		delete globalThis.pako;
		delete globalThis.unbrotli;
	});

	it('installs browser decompressors before importing lib-font', async () => {
		let globalsAtImport;

		vi.doMock('lib-font', () => {
			globalsAtImport = {
				pako: globalThis.pako,
				unbrotli: globalThis.unbrotli,
			};

			return {
				Font: class {
					constructor() {
						this.onload = null;
						this.onerror = null;
					}

					fromDataBuffer() {
						this.onload?.({ detail: { font: this } });
					}
				},
			};
		});

		const { parseFont } = await import('../utils/parseFont.js');
		const font = await parseFont(new ArrayBuffer(4), 'test.woff2');

		expect(font).toBeTruthy();
		expect(globalsAtImport?.pako?.inflate).toBeTypeOf('function');
		expect(globalsAtImport?.unbrotli).toBeTypeOf('function');
	});
});
