import { useEffect, useRef } from 'react'
import type { EventAlertRecord } from '../lib/event-alerts'
import './EventAlertOverlay.css'

export function EventAlertOverlay({ event, onClose, saveError, onRetryDismissal }: {
  event: EventAlertRecord
  onClose: () => void
  saveError?: string
  onRetryDismissal?: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const previousFocus = useRef<HTMLElement | null>(null)
  const titleId = `event-alert-title-${event.id}`
  const bodyId = `event-alert-body-${event.id}`

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleEscape(keyboardEvent: KeyboardEvent) {
      if (keyboardEvent.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (keyboardEvent.key !== 'Tab') return
      const focusable = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (!dialog.current?.contains(document.activeElement)) {
        keyboardEvent.preventDefault()
        first.focus()
      } else if (keyboardEvent.shiftKey && document.activeElement === first) {
        keyboardEvent.preventDefault()
        last.focus()
      } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
        keyboardEvent.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleEscape)
      if (previousFocus.current?.isConnected) previousFocus.current.focus()
      previousFocus.current = null
    }
  }, [])

  useEffect(() => {
    closeButton.current?.focus()
  }, [event.id])

  return <section
    ref={dialog}
    className="event-alert-overlay"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby={`event-alert-label-${event.id} ${titleId}`}
    aria-describedby={bodyId}
  >
    <button
      ref={closeButton}
      className="event-alert-close"
      type="button"
      aria-label={`Fechar alerta: ${event.title}`}
      onClick={onClose}
    >X</button>
    <div className="event-alert-content">
      <p className="event-alert-label" id={`event-alert-label-${event.id}`}>ALERTA!</p>
      <h1 id={titleId}>{event.title}</h1>
      <p className="event-alert-body" id={bodyId}>{event.body}</p>
    </div>
    {saveError && onRetryDismissal && <EventAlertSaveError message={saveError} onRetry={onRetryDismissal} />}
  </section>
}

export function EventAlertSaveError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="event-alert-save-error" role="alert">
    <span>O alerta foi fechado nesta tela, mas não foi possível salvar o fechamento: {message}</span>
    <button type="button" onClick={onRetry}>TENTAR NOVAMENTE</button>
  </div>
}
