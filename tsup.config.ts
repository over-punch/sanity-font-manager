import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['src/index.js'],
	format: ['esm', 'cjs'],
	dts: false,
	splitting: true,
	clean: true,
	jsx: true,
	external: [
		'react',
		'react-dom',
		'sanity',
		'@sanity/ui',
		'@sanity/icons',
		'@liiift-studio/sanity-advanced-reference-array',
		'zlib',
		'fs',
	],
})
