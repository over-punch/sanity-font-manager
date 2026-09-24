import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['src/index.js'],
	format: ['esm', 'cjs'],
	dts: false,
	splitting: false,
	clean: true,
	jsx: true,
	external: [
		'react',
		'react-dom',
		'sanity',
		'@sanity/ui',
		'@sanity/icons',
		'@overpunch/sanity-advanced-reference-array',
		'zlib',
		'fs',
	],
})
