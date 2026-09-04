import { describe, expect, it } from 'vitest'
import {
  addressConfirmReplyId,
  addressConfirmationBody,
  addressEditReplyId,
  formatInrFromPaise,
  parseAddressConfirmReply,
} from './address-confirm'
import { CONFIRM_BUTTON_TITLE, EDIT_BUTTON_TITLE } from './address-confirm'
import { INTERACTIVE_LIMITS } from '@/lib/whatsapp/meta-api'

const beneficiary = {
  name: 'Goutham',
  address_line1: 'Wayanad house, Sulthan Bathery',
  city: 'Wayanad',
  state: 'Kerala',
  country: 'India',
  postal_code: '673592',
}

describe('address confirmation reply ids', () => {
  it('round-trips the order reference through the button id', () => {
    const confirm = addressConfirmReplyId('wac_mtlsry8674y48w')
    const edit = addressEditReplyId('wac_mtlsry8674y48w')
    expect(parseAddressConfirmReply(confirm)).toEqual({
      action: 'confirm',
      referenceId: 'wac_mtlsry8674y48w',
    })
    expect(parseAddressConfirmReply(edit)).toEqual({
      action: 'edit',
      referenceId: 'wac_mtlsry8674y48w',
    })
  })

  it('ignores unrelated interactive replies', () => {
    expect(parseAddressConfirmReply('menu_option_1')).toBeNull()
    expect(parseAddressConfirmReply('wac_addr_ok:')).toBeNull()
    expect(parseAddressConfirmReply('wac_addr_ok:not a reference')).toBeNull()
    expect(parseAddressConfirmReply(null)).toBeNull()
  })

  it('keeps button labels inside Meta’s title limit', () => {
    expect(CONFIRM_BUTTON_TITLE.length).toBeLessThanOrEqual(
      INTERACTIVE_LIMITS.buttonTitleMaxLength,
    )
    expect(EDIT_BUTTON_TITLE.length).toBeLessThanOrEqual(
      INTERACTIVE_LIMITS.buttonTitleMaxLength,
    )
  })
})

describe('addressConfirmationBody', () => {
  it('shows the address and order total before asking for payment', () => {
    const body = addressConfirmationBody({
      beneficiary,
      totalPaise: 89900,
      itemCount: 1,
    })
    expect(body).toContain('Goutham')
    expect(body).toContain('Wayanad house, Sulthan Bathery')
    expect(body).toContain('Wayanad, Kerala 673592')
    expect(body).toContain('1 item · ₹899.00')
    expect(body).not.toContain('@')
    expect(body.length).toBeLessThanOrEqual(INTERACTIVE_LIMITS.bodyMaxLength)
  })

  it('lists an optional receipt email when present', () => {
    const body = addressConfirmationBody({
      beneficiary: { ...beneficiary, email: 'ada@example.com' },
      totalPaise: 89900,
      itemCount: 1,
    })
    expect(body).toContain('ada@example.com')
    expect(body.length).toBeLessThanOrEqual(INTERACTIVE_LIMITS.bodyMaxLength)
  })

  it('pluralises the item count', () => {
    const body = addressConfirmationBody({
      beneficiary,
      totalPaise: 179800,
      itemCount: 2,
    })
    expect(body).toContain('2 items · ₹1798.00')
  })
})

describe('formatInrFromPaise', () => {
  it('renders paise as rupees', () => {
    expect(formatInrFromPaise(89900)).toBe('₹899.00')
    expect(formatInrFromPaise(0)).toBe('₹0.00')
    expect(formatInrFromPaise(-500)).toBe('₹0.00')
  })
})
