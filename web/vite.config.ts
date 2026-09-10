import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// This repo is `ilanamost/ai-dev`, so its GitHub Pages project site serves from
// `https://ilanamost.github.io/ai-dev/` rather than the domain root — every built
// asset URL needs that prefix. Only the `production` build targets Pages; dev and
// every other mode stay at the root, so they are not forced onto a path prefix
// they do not need. If this repository is ever renamed, update this value.
const PAGES_BASE = '/ai-dev/'

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? PAGES_BASE : '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  css: {
    // Sass emits a leading `@charset "UTF-8";` whenever a source file contains
    // non-ASCII characters (the house comment style uses em dashes), even though the
    // minifier strips those comments and leaves no non-ASCII in the actual output.
    // Suppressing it keeps the compiled bundle identical to the pre-SCSS baseline.
    preprocessorOptions: { scss: { charset: false } }
  },
  build: {
    rollupOptions: {
      // 404.html is a second HTML entry so Vite injects the same hashed, base-prefixed
      // assets into it as into index.html. It is what GitHub Pages serves for any path
      // the static host has no file for — see the comment in 404.html.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        404: fileURLToPath(new URL('./404.html', import.meta.url))
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.ts']
  }
}))
