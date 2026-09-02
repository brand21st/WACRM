import { describe, it, expect } from 'vitest'
import { clampPopupRect, offsetFromClampedRect } from './popup-drag'

describe('clampPopupRect', () => {
  it('keeps a card inside the viewport with an 8px margin', () => {
    expect(clampPopupRect(400, 20, 320, 160, 1000, 800)).toEqual({
      left: 400,
      top: 20,
    })
    expect(clampPopupRect(-40, -10, 320, 160, 1000, 800)).toEqual({
      left: 8,
      top: 8,
    })
    expect(clampPopupRect(900, 700, 320, 160, 1000, 800)).toEqual({
      left: 672,
      top: 632,
    })
  })
})

describe('offsetFromClampedRect', () => {
  it('converts a clamped visual position back to a translate offset', () => {
    const start = { x: 12, y: -8 }
    const rect = { left: 640, top: 16, width: 320, height: 160 }
    expect(offsetFromClampedRect(start, rect, 500, 40, 1000, 800)).toEqual({
      x: 12 + (500 - 640),
      y: -8 + (40 - 16),
    })
    expect(offsetFromClampedRect(start, rect, -100, 40, 1000, 800)).toEqual({
      x: 12 + (8 - 640),
      y: -8 + (40 - 16),
    })
  })
})
