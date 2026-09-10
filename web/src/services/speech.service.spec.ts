import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendTranscript,
  createWebSpeechSource,
  type SpeechErrorEventLike,
  type SpeechRecognitionLike,
  type SpeechResultEventLike
} from './speech.service'

/** Stands in for the browser's recognition object, which jsdom does not provide. */
class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null
  static failOnStart = false

  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: SpeechResultEventLike) => void) | null = null
  onerror: ((event: SpeechErrorEventLike) => void) | null = null
  onend: (() => void) | null = null
  aborted = false

  constructor() {
    FakeRecognition.last = this
  }

  start() {
    if (FakeRecognition.failOnStart) throw new Error('InvalidStateError')
  }

  stop() {
    this.onend?.()
  }

  abort() {
    this.aborted = true
    // The real API reports a user-initiated abort as an error, then ends.
    this.onerror?.({ error: 'aborted' })
    this.onend?.()
  }

  hear(chunks: Array<{ transcript: string; isFinal: boolean }>, resultIndex = 0) {
    const results = chunks.map(chunk =>
      Object.assign([{ transcript: chunk.transcript }], { isFinal: chunk.isFinal })
    )
    this.onresult?.({ resultIndex, results })
  }

  fail(error: string) {
    this.onerror?.({ error })
    this.onend?.()
  }
}

function installRecognition() {
  FakeRecognition.last = null
  FakeRecognition.failOnStart = false
  ;(window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition
}

function makeHandlers() {
  return { onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() }
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition
  FakeRecognition.failOnStart = false
})

describe('appendTranscript', () => {
  it('uses the chunk alone when the box is empty', () => {
    expect(appendTranscript('', 'hello there')).toBe('hello there')
  })

  it('separates typed text from spoken text with exactly one space', () => {
    expect(appendTranscript('I would start by ', 'measuring')).toBe('I would start by measuring')
  })

  it('leaves the existing text alone when nothing was heard', () => {
    expect(appendTranscript('typed', '   ')).toBe('typed')
  })
})

describe('createWebSpeechSource', () => {
  describe('isSupported', () => {
    it('reports unsupported when the browser has no recognition API', () => {
      expect(createWebSpeechSource().isSupported()).toBe(false)
    })

    it('reports supported once the API is present', () => {
      installRecognition()

      expect(createWebSpeechSource().isSupported()).toBe(true)
    })
  })

  describe('start', () => {
    it('reports the unsupported error instead of throwing when the API is missing', () => {
      const handlers = makeHandlers()

      createWebSpeechSource().start(handlers)

      expect(handlers.onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'NOT_SUPPORTED' })
      )
      expect(handlers.onEnd).toHaveBeenCalledOnce()
    })

    it('listens through pauses and streams words before they settle', () => {
      installRecognition()
      const handlers = makeHandlers()

      createWebSpeechSource().start(handlers)

      expect(FakeRecognition.last?.continuous).toBe(true)
      expect(FakeRecognition.last?.interimResults).toBe(true)
    })

    it('marks settled speech final and in-progress speech interim', () => {
      installRecognition()
      const handlers = makeHandlers()
      createWebSpeechSource().start(handlers)

      FakeRecognition.last?.hear([
        { transcript: 'I would measure first.', isFinal: true },
        { transcript: 'then I would', isFinal: false }
      ])

      expect(handlers.onTranscript).toHaveBeenCalledWith('I would measure first.', true)
      expect(handlers.onTranscript).toHaveBeenCalledWith('then I would', false)
    })

    it('only delivers results the browser has not delivered before', () => {
      installRecognition()
      const handlers = makeHandlers()
      createWebSpeechSource().start(handlers)

      FakeRecognition.last?.hear(
        [
          { transcript: 'already sent', isFinal: true },
          { transcript: 'new words', isFinal: true }
        ],
        1
      )

      expect(handlers.onTranscript).toHaveBeenCalledExactlyOnceWith('new words', true)
    })

    it('maps a blocked microphone to an actionable error', () => {
      installRecognition()
      const handlers = makeHandlers()
      createWebSpeechSource().start(handlers)

      FakeRecognition.last?.fail('not-allowed')

      expect(handlers.onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'MIC_DENIED', message: expect.stringContaining('blocked') })
      )
    })

    it('maps an unreachable transcription service to a network error', () => {
      installRecognition()
      const handlers = makeHandlers()
      createWebSpeechSource().start(handlers)

      FakeRecognition.last?.fail('network')

      expect(handlers.onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'SPEECH_NETWORK' })
      )
    })

    it('treats a user-initiated abort as a normal end, not an error', () => {
      installRecognition()
      const handlers = makeHandlers()

      createWebSpeechSource().start(handlers).abort()

      expect(handlers.onError).not.toHaveBeenCalled()
      expect(handlers.onEnd).toHaveBeenCalledOnce()
    })

    it('surfaces a refused start rather than leaving the caller listening forever', () => {
      installRecognition()
      FakeRecognition.failOnStart = true
      const handlers = makeHandlers()

      createWebSpeechSource().start(handlers)

      expect(handlers.onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'SPEECH_FAILED' })
      )
      expect(handlers.onEnd).toHaveBeenCalledOnce()
    })
  })
})
