import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLoaderStore } from './loader.store'

describe('loader.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts idle', () => {
    const loader = useLoaderStore()

    expect(loader.pending).toBe(0)
    expect(loader.isLoading).toBe(false)
  })

  it('stays loading while any call is pending and goes idle after the last one', () => {
    const loader = useLoaderStore()

    loader.start()
    loader.start()
    expect(loader.pending).toBe(2)
    expect(loader.isLoading).toBe(true)

    loader.stop()
    expect(loader.isLoading).toBe(true)

    loader.stop()
    expect(loader.pending).toBe(0)
    expect(loader.isLoading).toBe(false)
  })

  it('never drops below zero, so a stray stop cannot swallow the next call', () => {
    const loader = useLoaderStore()

    loader.stop()
    loader.stop()
    expect(loader.pending).toBe(0)

    loader.start()
    expect(loader.isLoading).toBe(true)
  })
})
