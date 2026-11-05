import { useRef, useState } from 'react'
import type { PointerEvent, KeyboardEvent } from 'react'
import './IdentityRecoveryPopup.css'

const POPUP_WIDTH = 340
const VIEWPORT_GAP = 12

function initialPosition() {
  if (typeof window === 'undefined') return { x: VIEWPORT_GAP, y: 80 }
  return {
    x: Math.max(VIEWPORT_GAP, window.innerWidth - POPUP_WIDTH - VIEWPORT_GAP),
    y: 80,
  }
}

export function IdentityRecoveryPopup({ playerName, busy, onAllow, onReject }: {
  playerName: string
  busy: boolean
  onAllow: () => void
  onReject: () => void
}) {
  const [position, setPosition] = useState(initialPosition)
  const dragOffset = useRef<{ pointerId: number; x: number; y: number } | null>(null)

  function startDragging(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds) return
    dragOffset.current = {
      pointerId: event.pointerId,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function movePopup(event: PointerEvent<HTMLDivElement>) {
    if (dragOffset.current?.pointerId !== event.pointerId) return
    const popup = event.currentTarget.parentElement
    if (!popup) return
    const width = popup.getBoundingClientRect().width
    const height = popup.getBoundingClientRect().height
    setPosition({
      x: Math.max(VIEWPORT_GAP, Math.min(window.innerWidth - width - VIEWPORT_GAP, event.clientX - dragOffset.current.x)),
      y: Math.max(VIEWPORT_GAP, Math.min(window.innerHeight - height - VIEWPORT_GAP, event.clientY - dragOffset.current.y)),
    })
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    if (dragOffset.current?.pointerId !== event.pointerId) return
    dragOffset.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const distance = event.shiftKey ? 40 : 12
    const popup = event.currentTarget.parentElement
    if (!popup) return
    const width = popup.getBoundingClientRect().width
    const height = popup.getBoundingClientRect().height
    const movement = {
      ArrowLeft: { x: -distance, y: 0 },
      ArrowRight: { x: distance, y: 0 },
      ArrowUp: { x: 0, y: -distance },
      ArrowDown: { x: 0, y: distance },
    }[event.key]
    if (!movement) return
    event.preventDefault()
    setPosition((current) => ({
      x: Math.max(VIEWPORT_GAP, Math.min(window.innerWidth - width - VIEWPORT_GAP, current.x + movement.x)),
      y: Math.max(VIEWPORT_GAP, Math.min(window.innerHeight - height - VIEWPORT_GAP, current.y + movement.y)),
    }))
  }

  return <section
    className="identity-recovery-popup"
    style={{ left: position.x, top: position.y }}
    role="region"
    aria-label="Solicitação de recuperação de identidade"
  >
    <div
      className="identity-recovery-popup-handle"
      tabIndex={0}
      role="toolbar"
      aria-label="Mover aviso. Use as setas do teclado para mover; Shift e seta move mais longe."
      onPointerDown={startDragging}
      onPointerMove={movePopup}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={moveWithKeyboard}
    >
      <span>RECUPERAÇÃO DE IDENTIDADE</span>
      <span aria-hidden="true">⠿</span>
    </div>
    <p>Alguém está tentando entrar novamente como <strong>{playerName}</strong>.</p>
    <div className="identity-recovery-popup-actions">
      <button className="primary-button" type="button" disabled={busy} onClick={onAllow}>
        {busy ? 'AGUARDE…' : 'PERMITIR'}
      </button>
      <button className="danger-button" type="button" disabled={busy} onClick={onReject}>
        {busy ? 'AGUARDE…' : 'RECUSAR'}
      </button>
    </div>
  </section>
}
