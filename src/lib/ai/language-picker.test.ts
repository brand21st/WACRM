import { describe, expect, it } from 'vitest'
import { INTERACTIVE_LIMITS } from '@/lib/whatsapp/meta-api'
import {
  buildLanguagePickerList,
  isCasualGreeting,
  isLanguagePickerReply,
  languageHelpAsk,
  languageLockConfirmation,
  languagePickerCode,
  languageWelcomeHi,
  priorCustomerQuestion,
  LANGUAGE_PICKER_IDS,
} from './language-picker'

describe('language picker ids', () => {
  it('recognizes list taps and formatted action lines', () => {
    expect(languagePickerCode(LANGUAGE_PICKER_IDS.ml)).toBe('ml')
    expect(isLanguagePickerReply('wacrm:lang:ta')).toBe(true)
    expect(
      languagePickerCode('[Customer tapped "Malayalam" (action: wacrm:lang:ml)]'),
    ).toBe('ml')
    expect(isLanguagePickerReply('wacrm:products')).toBe(false)
    expect(isLanguagePickerReply('wacrm:lang:te')).toBe(false)
  })
})

describe('language picker copy', () => {
  it('greets with the first name when we have one', () => {
    expect(languageWelcomeHi('Anil')).toBe('Hi, Anil')
    expect(languageWelcomeHi(null)).toBe('Hi')
  })

  it('builds a four-language list within Meta limits', () => {
    const list = buildLanguagePickerList()
    expect(list.bodyText).toBe('What’s your language?')
    expect(list.buttonLabel.length).toBeLessThanOrEqual(
      INTERACTIVE_LIMITS.buttonTitleMaxLength,
    )
    const ids = list.sections[0]?.rows.map((row) => row.id)
    expect(ids).toEqual([
      LANGUAGE_PICKER_IDS.en,
      LANGUAGE_PICKER_IDS.hi,
      LANGUAGE_PICKER_IDS.ml,
      LANGUAGE_PICKER_IDS.ta,
    ])
    for (const row of list.sections[0]?.rows ?? []) {
      expect(row.title.length).toBeLessThanOrEqual(
        INTERACTIVE_LIMITS.listRowTitleMaxLength,
      )
    }
  })

  it('confirms and asks for help in the locked language', () => {
    expect(
      languageLockConfirmation({
        code: 'ml',
        name: 'Malayalam',
        script: 'native',
        locked: true,
      }),
    ).toMatch(/മലയാളത്തിൽ/)
    expect(
      languageHelpAsk({
        code: 'en',
        name: 'English',
        script: 'latin',
        locked: true,
      }),
    ).toBe('How can I help you?')
  })
})

describe('priorCustomerQuestion', () => {
  it('returns the earlier product ask and skips greetings and taps', () => {
    expect(
      priorCustomerQuestion([
        { role: 'user', content: 'hi' },
        { role: 'user', content: 'I want the red saree' },
        { role: 'assistant', content: 'Hi' },
        {
          role: 'user',
          content: '[Customer tapped "Malayalam" (action: wacrm:lang:ml)]',
        },
      ]),
    ).toBe('I want the red saree')
    expect(
      priorCustomerQuestion([
        { role: 'user', content: 'hello' },
        {
          role: 'user',
          content: '[Customer tapped "English" (action: wacrm:lang:en)]',
        },
      ]),
    ).toBeNull()
    expect(isCasualGreeting('നമസ്കാരം')).toBe(true)
  })
})
