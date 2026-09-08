import { describe, expect, it } from 'vitest'
import { buildMetaCatalogPickerPayload } from './meta-catalogs'

describe('buildMetaCatalogPickerPayload', () => {
  it('maps Graph catalogs and keeps selected/primary', () => {
    const payload = buildMetaCatalogPickerPayload({
      graph: {
        status: 'ok',
        catalogs: [
          { id: '111', name: 'Main store' },
          { id: '222', name: 'Outlet' },
        ],
      },
      selectedIds: ['222', '111'],
      primaryId: '111',
    })
    expect(payload).toEqual({
      catalogs: [
        { id: '111', name: 'Main store' },
        { id: '222', name: 'Outlet' },
      ],
      selectedIds: ['222', '111'],
      primaryId: '111',
      reason: null,
    })
  })

  it('appends a selected id that Graph did not return', () => {
    const payload = buildMetaCatalogPickerPayload({
      graph: {
        status: 'ok',
        catalogs: [{ id: '111', name: 'Main store' }],
      },
      selectedIds: ['111', '999'],
      primaryId: '111',
    })
    expect(payload.catalogs).toEqual([
      { id: '111', name: 'Main store' },
      { id: '999', name: '999' },
    ])
    expect(payload.reason).toBeNull()
  })

  it('returns an empty list when WhatsApp is not connected', () => {
    const payload = buildMetaCatalogPickerPayload({
      graph: null,
      selectedIds: ['111'],
      primaryId: '111',
    })
    expect(payload).toEqual({
      catalogs: [],
      selectedIds: ['111'],
      primaryId: '111',
      reason: 'connect_whatsapp',
    })
  })

  it('keeps the paste fallback when Graph returns no catalogs', () => {
    const payload = buildMetaCatalogPickerPayload({
      graph: { status: 'ok', catalogs: [] },
      selectedIds: ['111'],
      primaryId: '111',
    })
    expect(payload.catalogs).toEqual([])
    expect(payload.reason).toBe('none_connected')
    expect(payload.selectedIds).toEqual(['111'])
  })
})
