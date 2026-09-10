/**
 * Speech-to-text for the answer box.
 *
 * `SpeechSource` is a contract first and a Web Speech API call second, mirroring
 * `InterviewSource` in interview.service.ts: the browser implementation ships now,
 * and a backend-transcription source can replace it later without the component
 * changing. Anthropic's API takes text, images, and PDFs but not audio, so a
 * server-side path would mean a separate transcription provider — deferred.
 *
 * Deviation from the stateless-service rule (.rule/coding-rules.md): a live
 * recognition is inherently stateful, so `start` hands the caller a session
 * handle to own. The module itself keeps no state.
 */

/** Fired once per session, whatever ended it — error, cancel, or the browser giving up. */
export interface SpeechHandlers {
  /** A chunk of speech. `isFinal` chunks are settled; interim ones are still being revised. */
  onTranscript(text: string, isFinal: boolean): void
  onError(error: SpeechError): void
  onEnd(): void
}

export interface SpeechSession {
  /** Finish listening and keep what was heard. */
  stop(): void
  /** Finish listening and throw away what was heard. */
  abort(): void
}

export interface SpeechSource {
  isSupported(): boolean
  start(handlers: SpeechHandlers): SpeechSession
}

/** User-safe error carrying a machine-readable code (.rule/error-handling-rules.md). */
export class SpeechError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'SpeechError'
  }
}

/**
 * The slice of the Web Speech API this service touches, declared locally so the
 * project needs neither a new `@types` package nor a global ambient file.
 */
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechResultEventLike) => void) | null
  onerror: ((event: SpeechErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export interface SpeechResultEventLike {
  /** Index of the first result not yet delivered — earlier ones were already handled. */
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

export interface SpeechErrorEventLike {
  error: string
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

const ERRORS: Record<string, SpeechError> = {
  'not-allowed': new SpeechError(
    'MIC_DENIED',
    'Microphone access was blocked. Allow it in your browser settings to answer by voice.'
  ),
  'service-not-allowed': new SpeechError(
    'MIC_DENIED',
    'Microphone access was blocked. Allow it in your browser settings to answer by voice.'
  ),
  'no-speech': new SpeechError('NO_SPEECH', 'We did not hear anything. Try again, closer to the mic.'),
  'audio-capture': new SpeechError(
    'NO_MIC',
    'No microphone was found. Check your device and try again.'
  ),
  network: new SpeechError(
    'SPEECH_NETWORK',
    'Speech transcription is unreachable right now. Type your answer instead.'
  )
}

const UNSUPPORTED = new SpeechError(
  'NOT_SUPPORTED',
  'Voice input is not available in this browser. Type your answer instead.'
)

const FAILED_TO_START = new SpeechError(
  'SPEECH_FAILED',
  'Voice input could not start. Try again, or type your answer.'
)

function toSpeechError(code: string): SpeechError {
  return ERRORS[code] ?? new SpeechError('SPEECH_FAILED', 'Voice input stopped unexpectedly. Try again.')
}

/** Chrome exposes this prefixed; the spec name is what everyone else will use. */
function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null

  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }

  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/** Join a transcript chunk onto whatever is already in the box, without doubling spaces. */
export function appendTranscript(existing: string, chunk: string): string {
  const addition = chunk.trim()
  if (!addition) return existing
  if (!existing.trim()) return addition
  return `${existing.replace(/\s+$/, '')} ${addition}`
}

const NOOP_SESSION: SpeechSession = { stop: () => {}, abort: () => {} }

export function createWebSpeechSource(lang = 'en-US'): SpeechSource {
  return {
    isSupported: () => getRecognitionCtor() !== null,

    start(handlers) {
      const Recognition = getRecognitionCtor()
      if (!Recognition) {
        handlers.onError(UNSUPPORTED)
        handlers.onEnd()
        return NOOP_SESSION
      }

      const recognition = new Recognition()
      recognition.lang = lang
      // Keep listening through natural pauses, and show words before they settle.
      recognition.continuous = true
      recognition.interimResults = true

      // A user-initiated abort reports itself as an error; that is not one.
      let aborted = false

      recognition.onresult = event => {
        let settled = ''
        let pending = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) settled += result[0].transcript
          else pending += result[0].transcript
        }

        if (settled) handlers.onTranscript(settled, true)
        if (pending) handlers.onTranscript(pending, false)
      }

      recognition.onerror = event => {
        if (aborted || event.error === 'aborted') return
        handlers.onError(toSpeechError(event.error))
      }

      recognition.onend = () => handlers.onEnd()

      try {
        recognition.start()
      } catch {
        handlers.onError(FAILED_TO_START)
        handlers.onEnd()
        return NOOP_SESSION
      }

      return {
        stop: () => recognition.stop(),
        abort: () => {
          aborted = true
          recognition.abort()
        }
      }
    }
  }
}

export const speechSource: SpeechSource = createWebSpeechSource()
