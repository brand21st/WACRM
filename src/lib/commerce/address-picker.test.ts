import { describe, expect, it } from 'vitest'
import {
  ADD_NEW_ADDRESS_TITLE,
  addNewAddressReplyId,
  parseSavedAddressPickerReply,
  savedAddressPickerRows,
  savedAddressUseReplyId,
} from './address-picker'

const beneficiary = {
  name: 'Goutham',
  address_line1: 'Wayanad House',
  address_line2: '124666 Ggg',
  city: 'Wayanad',
  state: 'Kerala',
  country: 'India',
  postal_code: '649592',
}

describe('saved address picker reply ids', () => {
  it('round-trips a saved address tap', () => {
    const id = savedAddressUseReplyId(
      'wac_mtmxhqlyv8deqt',
      '928cfd96-f285-47df-ab26-90984528534a',
    )
    expect(parseSavedAddressPickerReply(id)).toEqual({
      action: 'use',
      referenceId: 'wac_mtmxhqlyv8deqt',
      savedAddressId: '928cfd96-f285-47df-ab26-90984528534a',
    })
  })

  it('round-trips add new', () => {
    expect(parseSavedAddressPickerReply(addNewAddressReplyId('wac_mtmxhqlyv8deqt'))).toEqual({
      action: 'new',
      referenceId: 'wac_mtmxhqlyv8deqt',
    })
  })

  it('ignores address confirm taps', () => {
    expect(parseSavedAddressPickerReply('wac_addr_ok:wac_mtmxhqlyv8deqt')).toBeNull()
    expect(parseSavedAddressPickerReply('wac_addr_edit:wac_mtmxhqlyv8deqt')).toBeNull()
  })
})

describe('savedAddressPickerRows', () => {
  it('lists saved addresses then Add new', () => {
    const rows = savedAddressPickerRows({
      referenceId: 'wac_1',
      addresses: [{ id: '928cfd96-f285-47df-ab26-90984528534a', beneficiary }],
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: savedAddressUseReplyId('wac_1', '928cfd96-f285-47df-ab26-90984528534a'),
      title: 'Goutham',
      description: 'Wayanad House, Wayanad, 649592',
    })
    expect(rows[1]).toEqual({
      id: addNewAddressReplyId('wac_1'),
      title: ADD_NEW_ADDRESS_TITLE,
    })
  })

  it('keeps duplicate names unique for WhatsApp list titles', () => {
    const rows = savedAddressPickerRows({
      referenceId: 'wac_1',
      addresses: [
        { id: '928cfd96-f285-47df-ab26-90984528534a', beneficiary },
        {
          id: '6c0e966b-dc3e-47ef-9ef2-ff6bee5dcff5',
          beneficiary: { ...beneficiary, address_line1: 'Other house' },
        },
      ],
    })
    expect(rows[0].title).toBe('Goutham')
    expect(rows[1].title).toBe('Goutham 2')
  })
})
