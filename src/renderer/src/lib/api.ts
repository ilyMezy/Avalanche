import type { Channel, Req, Res } from '@shared/contracts'
import type { ErrorCode } from '@shared/errors'

/** An error returned by the main process. `message` is always safe to show to the user. */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Args<K extends Channel> = [Req<K>] extends [void] ? [] : [Req<K>]

/** Calls one of the typed IPC channels and unwraps the result, throwing `ApiError` on failure. */
export async function call<K extends Channel>(channel: K, ...args: Args<K>): Promise<Res<K>> {
  const result = await window.api[channel](args[0] as Req<K>)
  if (!result.ok) throw new ApiError(result.error.code, result.error.message)
  return result.data
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
