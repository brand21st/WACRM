/**
 * Shared customer-addressing rule for every customer-facing AI path.
 * Detect informal 2nd-person forms; never blindly replace them.
 */

const ML_LETTER = '\\u0D00-\\u0D7F'
const TA_LETTER = '\\u0B80-\\u0BFF'
const HI_LETTER = '\\u0900-\\u097F'

const INFORMAL_ML =
  new RegExp(
    String.raw`നിനക്കായി|നിനക്ക്|നിന്റെ|നിന്നോട്|നിന്നെ|നീയോട്|നീ(?![${ML_LETTER}])`,
  )
const INFORMAL_TA = new RegExp(String.raw`நீ(?![${TA_LETTER}])`)
const INFORMAL_HI = new RegExp(
  String.raw`(?:^|[^${HI_LETTER}])(?:तुम्हारा|तुम्हारे|तुम्हें|तुमको|तुम|तू)(?=$|[^${HI_LETTER}])`,
)
const INFORMAL_EN = /\b(?:bro|buddy|mate|dude)\b/i

export const CUSTOMER_ADDRESSING_INSTRUCTION =
  'CUSTOMER ADDRESSING: ' +
  'Always address the customer respectfully and naturally. ' +
  'Do not use informal or overly familiar second-person forms. ' +
  'In Malayalam, prefer «നിങ്ങൾ / നിങ്ങൾക്ക് / നിങ്ങളുടെ» or a pronoun-free line («ഏത് size ആണ് വേണ്ടത്?», «ഇത് കൂടി നോക്കാം»). ' +
  'Never use «നീ / നിനക്ക് / നിന്റെ / നിന്നോട് / നിന്നെ / നീയോട് / നിനക്കായി» for a customer-facing business conversation. ' +
  'Do not force «നിങ്ങൾ» into every sentence. Do not use stiff textbook Malayalam («താങ്കൾക്ക് ഏത് വർണ്ണമാണ് അഭിലഷണീയം?»). ' +
  'Tamil: «நீங்கள் / உங்களுக்கு / உங்கள்». Hindi: «आप / आपको / आपका». ' +
  'English: you is fine — never bro, buddy, mate, or dude. ' +
  'Do not rewrite quoted customer text, product titles, brand names, or catalog attributes.'

export const INFORMAL_ADDRESS_FIX_INSTRUCTION =
  'The draft uses informal or overly familiar second-person address. ' +
  'Rewrite only that address into respectful, natural shop speech. ' +
  'Prefer a pronoun-free line when it still sounds natural. ' +
  'Keep every fact, price, product name, SKU, order id, and URL. ' +
  'Do not change quoted customer text, product titles, or catalog names. ' +
  'Do not add questions or new claims. Output only the rewritten message.'

export function hasInformalCustomerAddress(
  text: string | null | undefined,
): boolean {
  const raw = stripQuotedSpans(text ?? '')
  if (!raw.trim()) return false
  return (
    INFORMAL_ML.test(raw) ||
    INFORMAL_TA.test(raw) ||
    INFORMAL_HI.test(raw) ||
    INFORMAL_EN.test(raw)
  )
}

function stripQuotedSpans(text: string): string {
  return text
    .replace(/«[^»]*»/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
}
