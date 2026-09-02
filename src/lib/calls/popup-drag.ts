export type PopupRect = {
  left: number
  top: number
  width: number
  height: number
}

export type PopupOffset = { x: number; y: number }

const MARGIN = 8

export function clampPopupRect(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = MARGIN,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewportWidth - width - margin)
  const maxTop = Math.max(margin, viewportHeight - height - margin)
  return {
    left: Math.min(maxLeft, Math.max(margin, left)),
    top: Math.min(maxTop, Math.max(margin, top)),
  }
}

export function offsetFromClampedRect(
  startOffset: PopupOffset,
  startRect: PopupRect,
  proposedLeft: number,
  proposedTop: number,
  viewportWidth: number,
  viewportHeight: number,
): PopupOffset {
  const clamped = clampPopupRect(
    proposedLeft,
    proposedTop,
    startRect.width,
    startRect.height,
    viewportWidth,
    viewportHeight,
  )
  return {
    x: startOffset.x + (clamped.left - startRect.left),
    y: startOffset.y + (clamped.top - startRect.top),
  }
}
