import { beforeEach, describe, expect, it } from 'vitest'
import { withStartupLoader } from './startup-loader.service'

function addStartupLoader() {
  const loader = document.createElement('div')
  loader.id = 'startup-loader'
  document.body.append(loader)
  return loader
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('startup loader', () => {
  it('stays visible until startup completes', async () => {
    const target = addStartupLoader()
    let completeStartup!: () => void
    const startup = withStartupLoader(
      () =>
        new Promise<void>(resolve => {
          completeStartup = resolve
        })
    )

    expect(target.textContent).toContain('Loading your interview workspace...')
    expect(target.querySelector('.spinner')).not.toBeNull()

    completeStartup()
    await startup

    expect(target.textContent).toBe('')
  })

  it('is removed when startup fails', async () => {
    const target = addStartupLoader()
    const failure = new Error('Startup failed')
    const startup = withStartupLoader(() => Promise.reject(failure))

    await expect(startup).rejects.toBe(failure)
    expect(target.textContent).toBe('')
  })

  it('reports a missing mount point instead of starting without a loader', async () => {
    await expect(withStartupLoader(async () => {})).rejects.toThrow(
      'Startup loader mount point was not found'
    )
  })
})
