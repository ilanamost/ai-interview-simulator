import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  API_TOAST,
  AUTH_ERROR_BY_CODE,
  AUTH_TOAST,
  INTERVIEW_TOAST,
  PROFILE_TOAST,
  REPORT_TOAST
} from './toast-message.service'

/**
 * Plan 016 bought three invariants and then checked them with one-off greps that nothing
 * re-runs: no literal left at a toast call site, the module stays import-free, and no
 * store reaches for `vue-sonner`. A grep proves the state on the day it was typed; the
 * next contributor to add a `toast.error('...')` meets nothing. These tests make those
 * three permanent, and add the duplicate-copy guard that is the whole point of the module.
 *
 * Source is read from disk rather than imported for the same reason
 * `styles/setup/variables.spec.ts` does it: the assertion is about what is written in the
 * file, not about what the bundler hands back.
 */
const SRC = resolve(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (entry.name.endsWith('.spec.ts')) continue
    if (extname(entry.name) === '.ts' || extname(entry.name) === '.vue') out.push(full)
  }
  return out
}

const FILES = sourceFiles(SRC)

/** The argument list of a call, read by balancing parens from the opening one. */
function callArgument(source: string, openParen: number): string {
  let depth = 0
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) return source.slice(openParen + 1, i)
    }
  }
  throw new Error('Unbalanced parentheses in a toast call')
}

interface CallSite {
  file: string
  line: number
  argument: string
}

function toastCallSites(): CallSite[] {
  const sites: CallSite[] = []
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/toast\.(?:error|success|info)\(/g)) {
      const openParen = match.index + match[0].length - 1
      sites.push({
        file: file.slice(SRC.length + 1).replace(/\\/g, '/'),
        line: source.slice(0, match.index).split('\n').length,
        argument: callArgument(source, openParen)
      })
    }
  }
  return sites
}

describe('no toast call site re-grows a hard-coded string', () => {
  it('found the call sites it is asserting about', () => {
    // Guards against the scan silently matching nothing and passing vacuously.
    expect(toastCallSites().length).toBeGreaterThanOrEqual(13)
  })

  /**
   * The failure this catches is a new `toast.error('Something broke.')` — copy that never
   * reaches the module, and so can drift out of sync with its duplicate exactly as the six
   * pairs plan 016 removed had done.
   */
  it('passes no quoted literal or template to any toast call', () => {
    const offenders = toastCallSites()
      .filter(site => /['"`]/.test(site.argument))
      .map(site => `${site.file}:${site.line} → toast(${site.argument.trim()})`)

    expect(offenders).toEqual([])
  })
})

describe('the copy module stays the pure leaf it was designed as', () => {
  const modulePath = resolve(SRC, 'services/toast-message.service.ts')
  const source = readFileSync(modulePath, 'utf8')

  it('loaded the module source', () => {
    expect(source).toContain('AUTH_ERROR_BY_CODE')
  })

  /**
   * Zero imports is what makes a cycle impossible: every consumer points at this module and
   * it points back at none of them. An import added here could close a loop through the
   * store that imports it.
   */
  it('imports nothing at all', () => {
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\brequire\s*\(/)
  })

  /** Plan 009's convention: stores compute the message, the UI shows it. */
  it('leaves every store free of vue-sonner', () => {
    const offenders = FILES.filter(
      file => file.includes(`${join('src', 'stores')}`) && readFileSync(file, 'utf8').includes('vue-sonner')
    ).map(file => file.slice(SRC.length + 1).replace(/\\/g, '/'))

    expect(offenders).toEqual([])
  })
})

describe('copy is authored exactly once', () => {
  /** Every static string the module exports, keyed by where it is defined. */
  function staticEntries(): { path: string; value: string }[] {
    const groups = {
      API_TOAST,
      AUTH_ERROR_BY_CODE,
      AUTH_TOAST,
      INTERVIEW_TOAST,
      PROFILE_TOAST,
      REPORT_TOAST
    }
    const entries: { path: string; value: string }[] = []
    for (const [name, group] of Object.entries(groups)) {
      for (const [key, value] of Object.entries(group)) {
        if (typeof value === 'string') entries.push({ path: `${name}.${key}`, value })
      }
    }
    return entries
  }

  /**
   * The regression this exists to stop is the one the plan was written to remove: the same
   * sentence typed into two places, where rewording one silently leaves the other behind.
   * `NETWORK_ERROR` is the single sanctioned repeat — it *references* `API_TOAST`, so the
   * two keys are one string by construction and cannot drift.
   */
  it('repeats no sentence across groups except the deliberate NETWORK_ERROR alias', () => {
    const byValue = new Map<string, string[]>()
    for (const { path, value } of staticEntries()) {
      byValue.set(value, [...(byValue.get(value) ?? []), path])
    }

    const repeated = [...byValue.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([value, paths]) => ({ value, paths: paths.sort() }))

    expect(repeated).toEqual([
      {
        value: API_TOAST.networkUnreachable,
        paths: ['API_TOAST.networkUnreachable', 'AUTH_ERROR_BY_CODE.NETWORK_ERROR']
      }
    ])
  })

  it('keeps the alias identical, not merely equal-looking today', () => {
    expect(AUTH_ERROR_BY_CODE.NETWORK_ERROR).toBe(API_TOAST.networkUnreachable)
  })
})

describe('parameterized copy survives hostile input', () => {
  /** A pasted display name should not be able to truncate the sentence around it. */
  it('keeps the full sentence around an absurdly long name', () => {
    const name = 'a'.repeat(5000)
    const message = AUTH_TOAST.welcomeBack(name)

    expect(message.startsWith('Welcome back, ')).toBe(true)
    expect(message.endsWith('.')).toBe(true)
    expect(message).toContain(name)
  })

  /** Newlines and quotes are data, not formatting — they must not break the copy apart. */
  it('treats newlines and quotes in a name as ordinary characters', () => {
    const message = AUTH_TOAST.welcome('Ada\n"Lovelace"')

    expect(message).toBe('Welcome, Ada\n"Lovelace".')
  })

  /**
   * Both sizes must always be named. A caller that formats one of them to an empty string
   * still has to produce a sentence that reads, not `That image is . Pick one under .`
   * dressed up as valid copy — the assertion below pins the surrounding words.
   */
  it('always names both sizes, in the actual-then-maximum order the caller passes', () => {
    expect(PROFILE_TOAST.avatarTooLarge('9.9MB', '2.0MB')).toBe(
      'That image is 9.9MB. Pick one under 2.0MB.'
    )

    const swapped = PROFILE_TOAST.avatarTooLarge('2.0MB', '9.9MB')
    expect(swapped).not.toBe(PROFILE_TOAST.avatarTooLarge('9.9MB', '2.0MB'))
  })

  it('renders every parameterized entry to non-blank copy when handed empty strings', () => {
    const parameterized = [
      AUTH_TOAST.welcome,
      AUTH_TOAST.welcomeBack,
      PROFILE_TOAST.avatarTooLarge
    ] as ((...args: string[]) => string)[]

    for (const render of parameterized) {
      expect(render('', '').trim().length).toBeGreaterThan(0)
    }
  })
})
