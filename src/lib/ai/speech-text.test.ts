import { describe, it, expect } from 'vitest'
import { prepareIndicSpeechText, stripUrlsForSpeech } from './speech-text'

describe('stripUrlsForSpeech', () => {
  it('drops a full https URL and keeps the sentence', () => {
    expect(
      stripUrlsForSpeech(
        'This looks like our Red Bag. Buy now: https://shop.example/cart/99:1?checkout',
      ),
    ).toBe('This looks like our Red Bag.')
  })

  it('keeps the label from a markdown link', () => {
    expect(
      stripUrlsForSpeech('See the [Red Bag](https://shop.example/products/red-bag) today.'),
    ).toBe('See the Red Bag today.')
  })

  it('drops www. links', () => {
    expect(stripUrlsForSpeech('Visit www.example.com/about for hours.')).toBe(
      'Visit for hours.',
    )
  })

  it('collapses leftover View: / Buy now: labels', () => {
    expect(
      stripUrlsForSpeech(
        'Red Bag\nView: https://shop.example/products/red-bag\nBuy now: https://shop.example/cart/99:1',
      ),
    ).toBe('Red Bag')
  })

  it('returns empty when the reply is only a URL', () => {
    expect(stripUrlsForSpeech('https://shop.example/products/red-bag')).toBe('')
  })

  it('leaves ordinary text alone', () => {
    expect(stripUrlsForSpeech('Hello! How can I help?')).toBe(
      'Hello! How can I help?',
    )
  })
})

describe('prepareIndicSpeechText', () => {
  it('expands leftover rupees and title-cases ALL-CAPS names in Malayalam', () => {
    expect(
      prepareIndicSpeechText('ഇതാ POURNAMI RED:PREMIUM COTTON SAREE ₹1499'),
    ).toBe('ഇതാ Pournami Red, Premium Cotton Saree, 1499 രൂപ')
  })

  it('uses Hindi currency for Devanagari and Tamil for Tamil script', () => {
    expect(prepareIndicSpeechText('ये ₹499')).toBe('ये, 499 रुपये')
    expect(prepareIndicSpeechText('இது Rs 1499')).toBe('இது, 1499 ரூபாய்')
  })

  it('leaves English ₹ for ElevenLabs to say rupees', () => {
    expect(prepareIndicSpeechText('Total ₹499')).toBe('Total ₹499')
  })

  it('expands Manglish leftover rupees with a Malayalam language hint', () => {
    expect(prepareIndicSpeechText('ithu ₹1499', 'ml')).toBe('ithu, 1499 രൂപ')
  })

  it('spaces 6+ digit ids and still strips nothing extra', () => {
    expect(prepareIndicSpeechText('OTP 482913')).toBe('OTP 4 8 2 9 1 3')
  })
})
