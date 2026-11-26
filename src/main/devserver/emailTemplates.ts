/**
 * The emails the MARS server sends to shop owners. Each returns the subject, a plain-text version (for mail apps that
 * do not show HTML) and the HTML version. The HTML is table-based with inline styles and no pictures or scripts, so it
 * looks the same in Gmail, Outlook and phone mail apps, and nothing is loaded from the internet.
 * (A copy of this file lives in mars-pos-desktop/src/main/devserver/ for the development stand-in server: keep them the same.)
 */
export interface Email { subject: string; text: string; html: string }

const INK = '#1C1917', MUTED = '#57534E', LINE = '#E2DDD6', ACCENT = '#B4441F', ACCENT_TEXT = '#8A3216', SOFT = '#FBEADF', BG = '#F5F3F0'
const SANS = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace"

/** Anything typed by a person (a shop name) is escaped before it goes into HTML. */
export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const p = (html: string): string => `<p style="margin:0 0 16px;font:400 16px/1.6 ${SANS};color:${INK}">${html}</p>`
const h1 = (t: string): string => `<h1 style="margin:0 0 12px;font:700 26px/1.25 ${SANS};color:${INK}">${t}</h1>`
const small = (html: string): string => `<p style="margin:0;font:400 13px/1.6 ${SANS};color:${MUTED}">${html}</p>`

/** A button that survives Outlook: the link is a table cell, not just a styled <a>. */
const button = (label: string, href: string): string => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr>
  <td align="center" bgcolor="${ACCENT}" style="border-radius:10px">
    <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font:700 16px/1 ${SANS};color:#FFFFFF;text-decoration:none;border-radius:10px">${esc(label)}</a>
  </td></tr></table>`

/** A big, easy-to-copy value: the code or the key. */
const valueBox = (value: string, size: number, spacing: string): string => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 20px"><tr>
  <td align="center" bgcolor="${SOFT}" style="border-radius:12px;padding:20px 8px;white-space:nowrap;font:700 ${size}px/1.2 ${MONO};letter-spacing:${spacing};color:${ACCENT_TEXT}">${esc(value)}</td>
</tr></table>`

/** A short boxed note, for the security line. */
const note = (html: string): string => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 0"><tr>
  <td style="border-left:4px solid ${ACCENT};background:${BG};padding:12px 14px;border-radius:0 8px 8px 0;font:400 14px/1.55 ${SANS};color:${MUTED}">${html}</td>
</tr></table>`

const steps = (items: string[]): string => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px">${items.map((t, i) => `
  <tr><td width="36" valign="top" style="padding:0 0 12px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="26" height="26" bgcolor="${ACCENT}" style="border-radius:13px;font:700 14px/26px ${SANS};color:#FFFFFF">${i + 1}</td></tr></table></td>
  <td valign="top" style="padding:2px 0 12px;font:400 15px/1.55 ${SANS};color:${INK}">${t}</td></tr>`).join('')}
</table>`

function layout(o: { preheader: string; body: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>MARS Cosmos</title></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG}">${esc(o.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BG}"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px">
    <tr><td bgcolor="${INK}" style="background:${INK};border-radius:14px 14px 0 0;padding:20px 32px;font:800 20px/1 ${SANS};color:#FFFFFF">
      <span style="color:#E0703F;font-size:22px">&#9679;</span>&nbsp; MARS Cosmos</td></tr>
    <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ${LINE};border-top:0;border-radius:0 0 14px 14px;padding:32px">${o.body}</td></tr>
    <tr><td style="padding:18px 8px 0;text-align:center;font:400 12px/1.6 ${SANS};color:${MUTED}">
      MARS Technolabs &middot; Mars Cosmos point of sale<br>You are receiving this because of a request made for your shop. If it was not you, you can ignore this email.</td></tr>
  </table>
</td></tr></table></body></html>`
}

/** Mobile / email verification code during onboarding. */
export function codeEmail(code: string, minutes = 10): Email {
  return {
    subject: `${code} is your MARS Cosmos verification code`,
    text: `Your MARS Cosmos verification code is ${code}.\nIt is valid for ${minutes} minutes.\n\nIf you did not ask for it, ignore this email.`,
    html: layout({
      preheader: `Your code is ${code}. It is valid for ${minutes} minutes.`,
      body: h1('Your verification code') + p('Type this code on the MARS onboarding page to confirm your email address.') + valueBox(code, 34, '0.35em') +
        p(`The code is valid for <b>${minutes} minutes</b>.`) + note('Never share this code with anyone. MARS will never ask you for it on a call.')
    })
  }
}

/** The activation key, after the shop is created. */
export function activationKeyEmail(shop: string, key: string): Email {
  return {
    subject: 'Your MARS Cosmos activation key',
    text: `Welcome to MARS Cosmos.\n\nActivation key for ${shop}:\n\n${key}\n\n1. Install Mars Cosmos on your shop PC.\n2. Choose "Activation key" on the first screen.\n3. Type this key and the mobile number you registered with.\n\nDo not share the key with anyone.`,
    html: layout({
      preheader: `Your activation key for ${shop}`,
      body: h1('Welcome to MARS Cosmos') + p(`Your shop <b>${esc(shop)}</b> is ready. This is your activation key:`) + valueBox(key, 20, '0.04em') +
        p('To start billing:') + steps(['Install <b>Mars Cosmos</b> on your shop PC.', 'On the first screen, choose <b>Activation key</b>.', 'Type this key and the <b>mobile number you registered with</b>.']) +
        note('The key works for one PC. Do not share it with anyone; if it is lost or used by mistake, contact MARS support.')
    })
  }
}

/** The forgot-PIN link. */
export function pinResetEmail(shop: string, link: string, minutes: number): Email {
  return {
    subject: 'Reset your MARS Cosmos PIN',
    text: `Someone asked to reset the owner PIN for ${shop}.\n\nOpen this link and choose a new 4-digit PIN. It works once and expires in ${minutes} minutes:\n\n${link}\n\nIf this was not you, ignore this email: nothing changes until a PIN is saved.`,
    html: layout({
      preheader: `Choose a new owner PIN for ${shop}. The link works once for ${minutes} minutes.`,
      body: h1('Reset your PIN') + p(`Someone asked to reset the owner PIN for <b>${esc(shop)}</b> on the shop PC. If that was you, choose a new 4-digit PIN:`) +
        button('Choose a new PIN', link) +
        p(`The link works <b>once</b> and expires in <b>${minutes} minutes</b>. After you save the PIN, Mars Cosmos on your shop PC picks it up in a few seconds.`) +
        small(`Button not working? Copy this address into your browser:<br><a href="${esc(link)}" style="color:${ACCENT_TEXT};word-break:break-all">${esc(link)}</a>`) +
        '<div style="height:18px"></div>' + note('Not you? Ignore this email. Nothing changes until a PIN is saved, and no one at MARS can see or set your PIN.')
    })
  }
}

/** Sent after the PIN was changed from the link. */
export function pinChangedEmail(shop: string): Email {
  return {
    subject: 'Your MARS Cosmos PIN was changed',
    text: `The owner PIN for ${shop} was just changed from the reset link.\n\nIf this was not you, call MARS support right away.`,
    html: layout({
      preheader: `The owner PIN for ${shop} was changed.`,
      body: h1('Your PIN was changed') + p(`The owner PIN for <b>${esc(shop)}</b> was just changed using the reset link. Log in to Mars Cosmos with your new PIN.`) +
        note('<b>Was this not you?</b> Call MARS support right away so the account can be secured.')
    })
  }
}
