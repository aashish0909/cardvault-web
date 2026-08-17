// Clash-safe OTP extraction from SMS / clipboard text.
//
// The owner can have two bank OTPs at once (their own txn on card A, a
// friend's request on card B). We only auto-fill when the text uniquely
// matches *this* request's card. Foreign last4s drop the whole message;
// ambiguous leftovers become tap-to-fill chips instead of a silent fill.
//
// The PWA cannot read the SMS inbox. Callers feed WebOTP codes, paste
// events, and clipboard reads into matchOtpFromText.

import { digitsOnly } from './cards';

export interface OtpHints {
  last4: string;
  amount?: string | null;
  merchant?: string | null;
}

export type OtpMatchResult =
  | { status: 'unique'; code: string }
  | { status: 'candidates'; codes: string[] }
  | { status: 'none'; reason: 'other-card' | 'empty' };

interface Span {
  value: string;
  start: number;
  end: number;
}

const OTP_LEN_MIN = 4;
const OTP_LEN_MAX = 8;

/** Card last4 as banks print it: "ending 1234", "XX1234", "****1234". */
const LAST4_RES: RegExp[] = [
  /(?:ending(?:\s+(?:in|with))?|last\s*4(?:\s*digits)?)\s*[:\-]?\s*(\d{4})/gi,
  /(?:xx+|\*{2,}|x{2,}|\u2022{2,}|\.{2,})\s*(\d{4})/gi,
  /card(?:\s*(?:no\.?|number|#))?\s*(?:xx+|\*{2,}|x{2,})?(\d{4})/gi,
];

const YEAR_RE = /^(?:19|20)\d{2}$/;

export function isBareOtp(text: string): boolean {
  return /^\s*\d{4,8}\s*$/.test(text);
}

export function matchOtpFromText(text: string, hints: OtpHints): OtpMatchResult {
  const raw = text.replace(/\u00a0/g, ' ').trim();
  if (!raw) return { status: 'none', reason: 'empty' };

  const last4 = digitsOnly(hints.last4).slice(-4);
  const last4Spans = findLast4Spans(raw);
  const listed = unique(last4Spans.map((s) => s.value));
  const hasOurs = last4.length === 4 && listed.includes(last4);
  const hasForeign = listed.some((v) => v !== last4);

  if (hasForeign && !hasOurs) {
    return { status: 'none', reason: 'other-card' };
  }

  const skip = skipNumbers(hints, listed);
  const codes = findDigitSpans(raw).filter((s) => {
    if (s.value.length < OTP_LEN_MIN || s.value.length > OTP_LEN_MAX) return false;
    if (skip.has(s.value)) return false;
    if (YEAR_RE.test(s.value)) return false;
    return true;
  });

  if (codes.length === 0) return { status: 'none', reason: 'empty' };

  const amountHit = amountAppears(raw, hints.amount);
  const merchantHit = merchantAppears(raw, hints.merchant);
  const hasAmountHint = digitsOnly(hints.amount ?? '').length > 0;
  const hasMerchantHint = (hints.merchant?.trim().length ?? 0) >= 3;

  const confirmed: Span[] = [];
  const unconfirmed: Span[] = [];
  for (const code of codes) {
    const verdict = classifyCode({
      code,
      last4Spans,
      last4,
      amountHit,
      merchantHit,
      hasAmountHint,
      hasMerchantHint,
    });
    if (verdict === 'drop') continue;
    if (verdict === 'confirmed') confirmed.push(code);
    else unconfirmed.push(code);
  }

  const confirmedUniq = unique(confirmed.map((s) => s.value));
  if (confirmedUniq.length === 1) {
    return { status: 'unique', code: confirmedUniq[0]! };
  }
  if (confirmedUniq.length > 1) {
    const keyed = unique(
      confirmed.filter((s) => nearOtpKeyword(raw, s)).map((s) => s.value)
    );
    if (keyed.length === 1) return { status: 'unique', code: keyed[0]! };
    return { status: 'candidates', codes: confirmedUniq };
  }

  const leftover = unique(unconfirmed.map((s) => s.value));
  if (leftover.length === 0) {
    return { status: 'none', reason: hasForeign ? 'other-card' : 'empty' };
  }
  // No last4/amount/merchant lock: never silent-fill (could be the other card).
  return { status: 'candidates', codes: leftover };
}

function classifyCode(opts: {
  code: Span;
  last4Spans: Span[];
  last4: string;
  amountHit: boolean;
  merchantHit: boolean;
  hasAmountHint: boolean;
  hasMerchantHint: boolean;
}): 'confirmed' | 'unconfirmed' | 'drop' {
  const owner = ownerLast4(opts.code, opts.last4Spans);
  if (owner) {
    return owner.value === opts.last4 ? 'confirmed' : 'drop';
  }
  if (opts.amountHit && opts.merchantHit) return 'confirmed';
  if (opts.amountHit && !opts.hasMerchantHint) return 'confirmed';
  if (opts.merchantHit && !opts.hasAmountHint) return 'confirmed';
  return 'unconfirmed';
}

// Bank SMS is almost always "OTP … card ending 1234". Each last4 owns the
// codes after the previous last4 and before/at itself; trailing codes after
// the final last4 still belong to that card (OTP-after-last4 layouts).
function ownerLast4(code: Span, last4Spans: Span[]): Span | null {
  if (last4Spans.length === 0) return null;
  const sorted = [...last4Spans].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const start = i === 0 ? 0 : sorted[i - 1]!.end;
    const end = sorted[i]!.end;
    if (code.start >= start && code.start < end) return sorted[i]!;
  }
  return sorted[sorted.length - 1]!;
}

function nearOtpKeyword(text: string, span: Span): boolean {
  const slice = text.slice(Math.max(0, span.start - 28), span.end + 28).toLowerCase();
  return /\botp\b|one[-\s]?time|\bpasscode\b|\bcode\b/.test(slice);
}

function skipNumbers(hints: OtpHints, listedLast4: string[]): Set<string> {
  const skip = new Set<string>(listedLast4);
  const last4 = digitsOnly(hints.last4).slice(-4);
  if (last4.length === 4) skip.add(last4);
  for (const n of amountVariants(hints.amount)) skip.add(n);
  return skip;
}

function findLast4Spans(text: string): Span[] {
  const out: Span[] = [];
  const seen = new Set<string>();
  for (const proto of LAST4_RES) {
    const re = new RegExp(proto.source, proto.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const value = m[1];
      const full = m[0];
      if (!value || !full) continue;
      const start = m.index + full.lastIndexOf(value);
      const key = `${start}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value, start, end: start + value.length });
    }
  }
  return out;
}

function findDigitSpans(text: string): Span[] {
  const out: Span[] = [];
  const re = /\d{4,8}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const value = m[0];
    out.push({ value, start: m.index, end: m.index + value.length });
  }
  return out;
}

function amountVariants(amount: string | null | undefined): Set<string> {
  const d = digitsOnly(amount ?? '');
  const out = new Set<string>();
  if (!d) return out;
  out.add(d);
  if (d.endsWith('00') && d.length > 2) out.add(d.slice(0, -2));
  else out.add(`${d}00`);
  return out;
}

function amountAppears(text: string, amount: string | null | undefined): boolean {
  const variants = amountVariants(amount);
  if (variants.size === 0) return false;
  const compact = text.replace(/[,\s]/g, '');
  for (const v of variants) {
    if (v.length < 2) continue;
    if (compact.includes(v)) return true;
  }
  return false;
}

function merchantAppears(text: string, merchant: string | null | undefined): boolean {
  const m = merchant?.trim().toLowerCase() ?? '';
  if (m.length < 3) return false;
  const lower = text.toLowerCase();
  if (lower.includes(m)) return true;
  const compact = m.replace(/[\s.'\-]/g, '');
  if (compact.length < 3) return false;
  return lower.replace(/[\s.'\-]/g, '').includes(compact);
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
