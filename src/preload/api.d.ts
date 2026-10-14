import type { Channel, Req, Res } from '@shared/contracts'
import type { IpcResult } from '@shared/errors'
import type { AppEvent, BootInfo } from '@shared/types'

export type PreloadApi = { [K in Channel]: (request: Req<K>) => Promise<IpcResult<Res<K>>> }

declare global {
  interface Window {
    api: PreloadApi
    boot: BootInfo
    appEvents: { subscribe(listener: (event: AppEvent) => void): () => void }
  }
}
