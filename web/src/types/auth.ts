/** Lifecycle of the auth store's session state. */
export enum AuthStatus {
  Idle = 'idle',
  /** The boot-time `fetchMe()` is in flight. */
  Checking = 'checking',
  /** A signup/login/logout/update the user is waiting on. */
  Busy = 'busy',
  /** Auth state is settled, signed in or not. */
  Ready = 'ready'
}
