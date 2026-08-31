import { describe, it, expect } from 'vitest'
import { enhanceSpeechText, prepareSpeechText } from './speech-text'

describe('prepareSpeechText', () => {
  it('strips bold and italic markdown', () => {
    expect(prepareSpeechText('Please pay **₹499** today')).toBe(
      '[friendly] Please pay [pause] rupees 499 today',
    )
    expect(prepareSpeechText('Say *hello* now')).toBe('[friendly] Say hello now')
  })

  it('strips leftover markdown headings but keeps order hashes', () => {
    expect(prepareSpeechText('# Welcome\nYour order is ready')).toBe(
      '[friendly] Welcome Your order is ready',
    )
    expect(prepareSpeechText('Order #12345 is packed')).toBe(
      '[friendly] Order #12345 is packed',
    )
  })

  it('speaks currency symbols', () => {
    expect(prepareSpeechText('₹499')).toBe('[friendly] [pause] rupees 499')
    expect(prepareSpeechText('Total $50')).toBe(
      '[friendly] Total [pause] dollars 50',
    )
  })

  it('spaces long digit runs for phones, OTPs, and order ids', () => {
    expect(prepareSpeechText('Call 9876543210')).toBe(
      '[friendly] Call [pause] 9 8 7 6 5 4 3 2 1 0',
    )
    expect(prepareSpeechText('OTP 482913')).toBe(
      '[friendly] OTP [pause] 4 8 2 9 1 3',
    )
  })

  it('leaves short prices and counts for ElevenLabs', () => {
    expect(prepareSpeechText('That is 499 rupees for 12 items')).toBe(
      '[friendly] That is 499 [pause] rupees for 12 items',
    )
    expect(prepareSpeechText('Order 12345 ships today')).toBe(
      '[friendly] Order 12345 ships today',
    )
  })

  it('returns empty after whitespace or markdown-only input', () => {
    expect(prepareSpeechText('   ')).toBe('')
    expect(prepareSpeechText('****')).toBe('')
  })
})

describe('enhanceSpeechText', () => {
  it('prefixes friendly and pauses before money and spaced ids', () => {
    expect(
      enhanceSpeechText(
        'Your total is rupees 499. Call 9 8 7 6 5 4 3 2 1 0.',
      ),
    ).toBe(
      '[friendly] Your total is [pause] rupees 499. Call [pause] 9 8 7 6 5 4 3 2 1 0.',
    )
  })

  it('prefixes softly on apologies', () => {
    expect(enhanceSpeechText("I'm sorry, that order is delayed.")).toBe(
      "[softly] I'm sorry, that order is delayed.",
    )
    expect(enhanceSpeechText('We apologise for the wait.')).toBe(
      '[softly] We apologise for the wait.',
    )
  })

  it('does not add a second leading emotion tag', () => {
    expect(enhanceSpeechText('[calm] Your order is ready')).toBe(
      '[calm] Your order is ready',
    )
    expect(
      enhanceSpeechText('[friendly] Total is rupees 499'),
    ).toBe('[friendly] Total is [pause] rupees 499')
  })

  it('does not double an existing pause or add a second tag', () => {
    expect(enhanceSpeechText('Pay [pause] rupees 499')).toBe(
      'Pay [pause] rupees 499',
    )
  })

  it('uses warmly on Indic script and speaks the native rupee word', () => {
    expect(prepareSpeechText('നിങ്ങളുടെ ആകെ ₹499')).toBe(
      '[warmly] നിങ്ങളുടെ ആകെ 499 [pause] രൂപ',
    )
  })

  it('uses softly on Malayalam and Hindi apologies', () => {
    expect(enhanceSpeechText('ക്ഷമിക്കണം, ഓർഡർ ലേറ്റ് ആണ്.')).toBe(
      '[softly] ക്ഷമിക്കണം, ഓർഡർ ലേറ്റ് ആണ്.',
    )
    expect(enhanceSpeechText('माफ कीजिए, ऑर्डर लेट है।')).toBe(
      '[softly] माफ कीजिए, ऑर्डर लेट है।',
    )
  })
})
