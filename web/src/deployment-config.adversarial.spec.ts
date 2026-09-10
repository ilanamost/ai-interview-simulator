// @vitest-environment node
//
// Node, not the suite-wide jsdom: importing vite.config pulls in
// @vitejs/plugin-vue and therefore esbuild, which asserts that
// `new TextEncoder().encode('') instanceof Uint8Array` — false under jsdom,
// whose TextEncoder comes from a different realm.
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ConfigEnv } from 'vite'
import viteConfig from '../vite.config'

/**
 * QA adversarial pass for plan 014's frontend deliverables.
 *
 * Everything the frontend agent changed lives in build configuration, so the
 * 586-test suite could not regress even if the Pages build broke completely —
 * a rename of the repo, a stray `base` edit, or someone "tidying away" the
 * second HTML entry would all ship silently and only surface as a blank
 * deployed page. These assertions are the only thing standing between that and
 * a green CI run.
 */

function configFor(mode: string, command: ConfigEnv['command'] = 'build') {
  return viteConfig({ mode, command })
}

describe('vite base path is scoped to the Pages build only', () => {
  it('prefixes production builds with the repo-name base GitHub Pages serves from', () => {
    // https://ilanamost.github.io/ai-dev/ — a bare '/' here means every asset
    // 404s on the deployed site.
    expect(configFor('production').base).toBe('/ai-dev/')
  })

  it.each(['development', 'staging', 'test'])(
    'leaves %s at the domain root, so nothing local is forced onto a path prefix',
    mode => {
      expect(configFor(mode).base).toBe('/')
    }
  )

  it('keeps the dev server at the root even though the config is now mode-aware', () => {
    // `npm run dev` must be byte-identical to its pre-plan-014 behavior.
    expect(configFor('development', 'serve').base).toBe('/')
  })

  it('does not leak the Pages base into an unrecognized mode', () => {
    // Anything that is not literally 'production' stays at the root — a typo'd
    // --mode should fail loudly at the asset level, not half-apply the prefix.
    expect(configFor('produciton').base).toBe('/')
    expect(configFor('').base).toBe('/')
  })
})

describe('404.html is a real build entry, not a public/ passthrough', () => {
  it('registers both index.html and 404.html as rollup inputs', () => {
    // A copy in public/ would be emitted verbatim, still pointing at /src/main.ts
    // with no base prefix — blank page on exactly the deep links it exists to fix.
    const input = configFor('production').build?.rollupOptions?.input as Record<string, string>

    expect(input).toBeTypeOf('object')
    expect(Object.keys(input).sort()).toEqual(['404', 'index'])
    expect(input['404']).toMatch(/404\.html$/)
    expect(input.index).toMatch(/index\.html$/)
  })

  it('registers 404.html in every mode, so a staging build is not silently deep-link-broken', () => {
    for (const mode of ['production', 'staging', 'development']) {
      const input = configFor(mode).build?.rollupOptions?.input as Record<string, string>
      expect(Object.keys(input)).toContain('404')
    }
  })
})

describe('404.html and index.html shells do not drift apart', () => {
  // The cost of hand-writing 404.html instead of generating it: the two shells
  // must stay in sync, and today only a code comment says so. A change to
  // index.html's pre-paint theme script that misses 404.html would give every
  // deep-linked visitor a theme flash the root URL does not have — invisible
  // locally, since nothing serves 404.html in dev.
  // Newlines are normalized: index.html is checked out CRLF on Windows while
  // 404.html is LF, which is a working-tree artifact, not drift worth failing on.
  const read = (name: string) =>
    readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

  const scriptOf = (html: string) => html.match(/<script>([\s\S]*?)<\/script>/)?.[1]?.trim()

  it('share the same pre-paint theme script', () => {
    expect(scriptOf(read('404.html'))).toBe(scriptOf(read('index.html')))
  })

  it('share the same mount point and module entry', () => {
    for (const fragment of ['<div id="app"></div>', '<script type="module" src="/src/main.ts">']) {
      expect(read('404.html')).toContain(fragment)
      expect(read('index.html')).toContain(fragment)
    }
  })

  it('share the same title and favicon link', () => {
    const meta = (html: string) => ({
      title: html.match(/<title>(.*?)<\/title>/)?.[1],
      icon: html.match(/<link rel="icon"[^>]*>/)?.[0]
    })
    expect(meta(read('404.html'))).toEqual(meta(read('index.html')))
  })
})

describe('config the app depends on survives the mode-aware refactor', () => {
  it.each(['production', 'staging', 'development', 'test'])(
    'keeps the @ alias pointing at src in %s mode',
    mode => {
      const alias = configFor(mode).resolve?.alias as Record<string, string>
      expect(alias['@']).toMatch(/src$/)
    }
  )

  it('keeps the vitest include pattern that finds these very specs', () => {
    expect(configFor('test').test?.include).toEqual(['src/**/*.spec.ts'])
  })
})
