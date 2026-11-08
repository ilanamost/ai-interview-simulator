import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { trackRequest } from './loader.service'
import { useLoaderStore } from '@/stores/loader.store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('trackRequest', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('counts the call as loading until it resolves, then passes its value through', async () => {
    const loader = useLoaderStore()
    const call = deferred<string>()

    const tracked = trackRequest(call.promise)
    expect(loader.isLoading).toBe(true)

    call.resolve('done')
    await expect(tracked).resolves.toBe('done')
    expect(loader.isLoading).toBe(false)
  })

  it('clears the loader when the call rejects, and rethrows the same error', async () => {
    const loader = useLoaderStore()
    const failure = new Error('network down')

    const tracked = trackRequest(Promise.reject(failure))
    expect(loader.isLoading).toBe(true)

    await expect(tracked).rejects.toBe(failure)
    expect(loader.isLoading).toBe(false)
  })

  it('keeps the loader up until both of two overlapping calls settle', async () => {
    const loader = useLoaderStore()
    const first = deferred<number>()
    const second = deferred<number>()

    const trackedFirst = trackRequest(first.promise)
    const trackedSecond = trackRequest(second.promise)
    expect(loader.pending).toBe(2)

    first.resolve(1)
    await trackedFirst
    expect(loader.isLoading).toBe(true)

    second.reject(new Error('late failure'))
    await expect(trackedSecond).rejects.toThrow('late failure')
    expect(loader.isLoading).toBe(false)
  })

  it('still runs the call, untracked, when no pinia is active', async () => {
    setActivePinia(undefined)

    await expect(trackRequest(Promise.resolve('ok'))).resolves.toBe('ok')
  })
})
