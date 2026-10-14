import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Button } from './button'
import { Input } from './controls'
import { Modal } from './overlays'

// Promise-based confirm and prompt dialogs, so any action can ask the user a question without
// each view having to own dialog state. Destructive actions always go through `confirmDialog`.

interface ConfirmOptions {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
}
interface PromptOptions {
  title: string
  label: string
  initialValue?: string
  placeholder?: string
  confirmLabel: string
  /** Returns an error message for an invalid value, or null when it is acceptable. */
  validate?(value: string): string | null
}

type Request =
  | { kind: 'confirm'; options: ConfirmOptions; resolve(value: boolean): void }
  | { kind: 'prompt'; options: PromptOptions; resolve(value: string | null): void }

const useDialogs = create<{ request: Request | null }>(() => ({ request: null }))

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useDialogs.setState({ request: { kind: 'confirm', options, resolve } }))
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => useDialogs.setState({ request: { kind: 'prompt', options, resolve } }))
}

function PromptBody({ request }: { request: Extract<Request, { kind: 'prompt' }> }): ReactNode {
  const { options, resolve } = request
  const [value, setValue] = useState(options.initialValue ?? '')
  const [touched, setTouched] = useState(false)
  const trimmed = value.trim()
  const problem = trimmed ? (options.validate?.(trimmed) ?? null) : 'A value is required.'
  const close = (result: string | null): void => {
    useDialogs.setState({ request: null })
    resolve(result)
  }
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close(null)}
      title={options.title}
      footer={
        <>
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button variant="primary" disabled={problem !== null} onClick={() => close(trimmed)}>
            {options.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (problem === null) close(trimmed)
          else setTouched(true)
        }}
      >
        <label className="mb-1.5 block text-xs font-medium text-muted" htmlFor="prompt-input">
          {options.label}
        </label>
        <Input
          id="prompt-input"
          autoFocus
          value={value}
          placeholder={options.placeholder}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setValue(event.target.value)
            setTouched(true)
          }}
          aria-invalid={touched && problem !== null}
        />
        <p className="mt-1.5 min-h-4 text-xs text-danger">{touched && trimmed ? problem : ''}</p>
      </form>
    </Modal>
  )
}

export function DialogHost(): ReactNode {
  const request = useDialogs((state) => state.request)
  const [key, setKey] = useState(0)
  useEffect(() => setKey((value) => value + 1), [request])
  if (!request) return null
  if (request.kind === 'prompt') return <PromptBody key={key} request={request} />
  const { options, resolve } = request
  const close = (result: boolean): void => {
    useDialogs.setState({ request: null })
    resolve(result)
  }
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close(false)}
      title={options.title}
      description={options.body}
      footer={
        <>
          {/* The safe choice is focused by default for destructive confirmations. */}
          <Button autoFocus={options.danger} onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={options.danger ? 'danger' : 'primary'} autoFocus={!options.danger} onClick={() => close(true)}>
            {options.confirmLabel}
          </Button>
        </>
      }
    />
  )
}
