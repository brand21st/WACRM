import { describe, it, expect } from 'vitest'
import {
  FULL_AGENT_FALLBACK_REPLY,
  buildSystemPrompt,
} from './defaults'

describe('buildSystemPrompt', () => {
  it('teaches spoken Indian-language matching including Manglish', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
    })
    expect(prompt).toMatch(/human-like customer support/i)
    expect(prompt).toMatch(/Manglish/i)
    expect(prompt).toMatch(/Manglish in stays Manglish/i)
    expect(prompt).toMatch(/Assamese/)
    expect(prompt).toMatch(/Urdu/)
    expect(prompt).toMatch(/No emojis, markdown/)
    expect(prompt).toMatch(/Certainly/)
    expect(prompt).toMatch(/Absolutely/)
    expect(prompt).toMatch(/never pretend an action completed/i)
    expect(prompt).toMatch(/Never paste English filler or labels|numbered English lists/)
    expect(prompt).toMatch(/do not read website URLs aloud/i)
    expect(prompt).toMatch(/Pronunciation/)
    expect(prompt).toMatch(/Never write ₹, Rs, Rs\., or INR/)
    expect(prompt).toMatch(/ALL-CAPS catalog slugs/)
    expect(prompt).toMatch(/रुपये/)
    expect(prompt).toMatch(/টাকা/)
    expect(prompt).toMatch(/રૂપિયા/)
    expect(prompt).toMatch(/ರೂಪಾಯಿ/)
    expect(prompt).toMatch(/രൂപ/)
    expect(prompt).toMatch(/ଟଙ୍କା/)
    expect(prompt).toMatch(/ਰੁਪਏ/)
    expect(prompt).toMatch(/ரூபாய்/)
    expect(prompt).toMatch(/రూపాయలు/)
    expect(prompt).toMatch(/നോക്കിക്കോ/)
    expect(prompt).toMatch(/ये वाला है/)
    expect(prompt).toMatch(/இது இருக்கு/)
    expect(prompt).toMatch(/ఇది ఉంది/)
    expect(prompt).toMatch(/Customer address/)
    expect(prompt).toMatch(/No customer name is known/)
    expect(prompt).toMatch(/Do not open every reply/)
    expect(prompt).toMatch(/never default to ji/)
    expect(prompt).toMatch(/No honorific by default/)
    expect(prompt).toMatch(/how can I help/)
    expect(prompt).toMatch(/Do not draft English first/)
    expect(prompt).toMatch(/natural native speech/)
    expect(prompt).toMatch(/How may I assist you today/)
    expect(prompt).toMatch(/human ear/)
    expect(prompt).toMatch(/Voice-friendly/)
    expect(prompt).toMatch(/verb-last/)
    expect(prompt).toMatch(/this is available for you/)
    expect(prompt).toMatch(/ലഭ്യമാണ്/)
    expect(prompt).toMatch(/നോക്കിക്കോ/)
  })

  it('names the customer when a speakable first name is provided', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      customerName: 'Anil',
    })
    expect(prompt).toMatch(/first name is Anil/)
    expect(prompt).toMatch(/Use it only if it naturally fits/)
    expect(prompt).toMatch(/never default to ji/)
    expect(prompt).not.toMatch(/No customer name is known/)
  })

  it('does not mention a missing live catalog when Shopify is off', () => {
    const auto = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
    })
    expect(auto).toMatch(/Do not mention Shopify/)
    expect(auto).toMatch(/can’t find live products|can't find live products/)
    expect(auto).toMatch(/without explaining missing systems/)
    expect(auto).not.toMatch(/search_store_info/)
    expect(auto).not.toMatch(/Shopify is connected/)

    const draft = buildSystemPrompt({
      userPrompt: null,
      mode: 'draft',
    })
    expect(draft).toMatch(/Do not mention Shopify/)
    expect(draft).not.toMatch(/search_store_info/)
  })

  it('keeps Shopify tool names in the lookup instructions', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      shopify: true,
    })
    expect(prompt).toMatch(/search_store_info/i)
    expect(prompt).toMatch(/delivery time/i)
    expect(prompt).toMatch(/customer-facing answer must still be in the customer/i)
    expect(prompt).toMatch(/Shopify is connected/)
    expect(prompt).toMatch(/Checkout NOW button and View cart button are sent separately/)
    expect(prompt).toMatch(/Do not paste checkout, cart, or Buy now URLs/)
    expect(prompt).toMatch(/call offer_cart/)
    expect(prompt).toMatch(/wacrm:confirm_order/)
    expect(prompt).toMatch(/wacrm:more_options/)
    expect(prompt).toMatch(/Product cards sent in chat already list in-stock variants/)
    expect(prompt).toMatch(/matching variants from tool results/)
    expect(prompt).not.toMatch(/Do not mention Shopify/)
    expect(prompt).not.toMatch(/can’t find live products|can't find live products/)
    expect(prompt).not.toMatch(/This is their first message/)
  })

  it('tells the model to use native WhatsApp cart when commerce is on', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      shopify: true,
      nativeCommerce: true,
    })
    expect(prompt).toMatch(/Add to cart/)
    expect(prompt).toMatch(/Send order/)
    expect(prompt).not.toMatch(/Checkout NOW button and View cart button are sent separately/)
  })

  it('requires a named shop welcome on the first Shopify inbound', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      shopify: true,
      firstInbound: true,
      customerName: 'Anil',
      shopName: 'Aurimo',
    })
    expect(prompt).toMatch(/This is their first message/)
    expect(prompt).toMatch(/MUST open with a short welcome using their first name Anil/)
    expect(prompt).toMatch(/Welcome them to Aurimo/)
    expect(prompt).toMatch(/This first reply must use it in the welcome/)
    expect(prompt).not.toMatch(/Use it only if it naturally fits/)
    expect(prompt).not.toMatch(/Mid-conversation: just answer/)
  })

  it('welcomes without inventing a name when the first name is unknown', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      shopify: true,
      firstInbound: true,
      shopName: 'Aurimo',
    })
    expect(prompt).toMatch(/This is their first message/)
    expect(prompt).toMatch(/without inventing a name/)
    expect(prompt).toMatch(/to Aurimo/)
    expect(prompt).toMatch(/No customer name is known/)
    expect(prompt).not.toMatch(/MUST open with a short welcome using their first name/)
  })

  it('does not add a first-turn welcome after the first message', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      shopify: true,
      firstInbound: false,
      customerName: 'Anil',
      shopName: 'Aurimo',
    })
    expect(prompt).toMatch(/Use it only if it naturally fits/)
    expect(prompt).toMatch(/Mid-conversation: just answer/)
    expect(prompt).not.toMatch(/This is their first message/)
    expect(prompt).not.toMatch(/MUST open with a short welcome/)
  })

  it('injects prior chat memory and tells the model not to re-ask or recite it', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      customerMemory: 'Profile: Wants Pournami Red. Last session: Asked for size M.',
    })
    expect(prompt).toMatch(/Customer memory from prior chats/)
    expect(prompt).toMatch(/Wants Pournami Red/)
    expect(prompt).toMatch(/Do not re-ask/)
    expect(prompt).toMatch(/Do not recite this dump/)
    expect(prompt).toMatch(/untrusted/)
  })

  it('omits the memory block when none is stored', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
    })
    expect(prompt).not.toMatch(/Customer memory from prior chats/)
  })

  it('locks the reply language until the customer asks to switch', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      replyLanguage: {
        code: 'ml',
        name: 'Malayalam',
        script: 'native',
        locked: true,
      },
    })
    expect(prompt).toMatch(/Locked reply language: Malayalam \(native script\)/)
    expect(prompt).toMatch(/not a language change/)
    expect(prompt).toMatch(/Only switch if they clearly ask/)
  })

  it('names a vision-matched product without asking for Buy URLs', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      shopify: true,
      photoMatches: [
        {
          title: 'Red Bag',
          priceMin: '49',
          priceMax: '49',
          currency: 'USD',
          productUrl: 'https://shop.example/products/red-bag',
          checkoutUrl: 'https://shop.example/cart/99:1?checkout',
        },
      ],
    })
    expect(prompt).toMatch(/Vision already matched this photo/)
    expect(prompt).toMatch(/Red Bag \(49 USD\)/)
    expect(prompt).toMatch(/Checkout NOW is sent separately/)
    expect(prompt).not.toMatch(/Include the View\/Buy/)
    expect(prompt).not.toMatch(/Buy: https/)
  })

  it('does not add a shop welcome when Shopify is off', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      firstInbound: true,
      customerName: 'Anil',
      shopName: 'Aurimo',
    })
    expect(prompt).not.toMatch(/This is their first message/)
    expect(prompt).not.toMatch(/Welcome them to Aurimo/)
    expect(prompt).toMatch(/Use it only if it naturally fits/)
  })
})

describe('FULL_AGENT_FALLBACK_REPLY', () => {
  it('is a warm bilingual Malayalam + English line', () => {
    expect(FULL_AGENT_FALLBACK_REPLY).toMatch(/ഞാൻ/)
    expect(FULL_AGENT_FALLBACK_REPLY).toMatch(/I'm here|I’ll help|I'll help/i)
  })
})
