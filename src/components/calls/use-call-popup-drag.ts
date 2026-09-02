'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { offsetFromClampedRect, type PopupOffset } from '@/lib/calls/popup-drag'

const ZERO: PopupOffset = { x: 0, y: 0 }

export function useCallPopupDrag(active: boolean) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [offset, setOffset] = useState<PopupOffset>(ZERO)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startOffset: PopupOffset
    startRect: DOMRect
  } | null>(null)

  useEffect(() => {
    if (!active) {
      dragRef.current = null
      setOffset(ZERO)
    }
  }, [active])

  useEffect(() => {
    if (!active) return

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const moved =
        Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY)
      if (moved < 4) return
      event.preventDefault()
      setOffset(
        offsetFromClampedRect(
          drag.startOffset,
          drag.startRect,
          drag.startRect.left + (event.clientX - drag.startX),
          drag.startRect.top + (event.clientY - drag.startY),
          window.innerWidth,
          window.innerHeight,
        ),
      )
    }

    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [active])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const card = cardRef.current
    if (!card) return
    // Do not preventDefault here — that cancels the Answer/Decline click
    // if the pointer started on the handle and the user meant to tap a button.
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offset,
      startRect: card.getBoundingClientRect(),
    }
  }, [offset])

  return {
    cardRef,
    offset,
    handleProps: {
      onPointerDown,
    },
  }
}
