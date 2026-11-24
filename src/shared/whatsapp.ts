/** Automatic birthday and anniversary wishes through the official WhatsApp Business (Cloud) API. */

export type WishKind = 'birthday' | 'anniversary'

export interface WaTemplate { name: string; language: string }

export interface WaSettings {
  on: boolean
  phoneNumberId: string
  /** the access token is never sent back to the screen: only whether one is saved */
  hasToken: boolean
  birthday: WaTemplate
  anniversary: WaTemplate
  /** wishes go out once the PC clock passes this hour (0-23) */
  sendHour: number
}
export interface WaSaveInput {
  on: boolean; phoneNumberId: string; birthday: WaTemplate; anniversary: WaTemplate; sendHour: number
  /** empty = keep the saved token */
  accessToken?: string
}

export interface WaOutboxRow {
  id: string; kind: WishKind; name: string; mobile: string; year: number
  status: 'queued' | 'sent' | 'failed'; tries: number; error: string | null; at: string; sentAt: string | null
}

export interface WaRunResult { queued: number; sent: number; failed: number; waiting: number }

/** Suggested wording to submit to Meta (two variables: {{1}} customer name, {{2}} shop name). */
export const WISH_SUGGESTIONS: Record<WishKind, string> = {
  birthday: 'Happy birthday {{1}}! Warm wishes from all of us at {{2}}. Visit us this week for a special surprise.',
  anniversary: 'Happy anniversary {{1}}! Warm wishes from all of us at {{2}}. Visit us this week for a special surprise.'
}
export const WA_DEFAULTS = { sendHour: 9, birthday: { name: 'birthday_wish', language: 'en' }, anniversary: { name: 'anniversary_wish', language: 'en' } }
