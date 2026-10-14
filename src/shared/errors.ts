export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'OUTSIDE_WORKSPACE'
  | 'FILE_LOCKED'
  | 'CONFLICT'
  | 'IO_ERROR'
  | 'UNAUTHORIZED'
  | 'INTERNAL'

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/** Errors cross the IPC boundary as data, never as thrown stack traces. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } }
