// antitells.js — ported verbatim from the Bridge (server/services/antitells.js).
// One source of truth for the AI writing tells: the negation-flip / antithesis
// and the "sit with it" family.

export const BAN_TEXT =
  'Never use the negation-flip / antithesis construction in any form: not the ' +
  'one-sentence "not X, it\'s Y", not the two-sentence "This is not X. This is ' +
  'Y.", and none of its variants ("isn\'t just X, it\'s Y", "not just X, but Y", ' +
  '"less X, more Y"). Never define a thing by what it is not. Say what it IS, ' +
  'once, plainly, and move on. Never tell them to "sit with" something, to "let ' +
  'it sit", "let that land", or "let it breathe". Say the thing and trust them.';

export const TELL_REMINDER =
  'Your draft used a banned construction: either the negation-flip / antithesis ' +
  '("not X, it\'s Y", or "This is not X. This is Y."), or a "sit with it / let ' +
  'that land" phrase. Rewrite it clean of BOTH. Never define a thing by what it ' +
  'is not. Say what it is, once, and move on.';

export function hasTells(text) {
  if (!text) return false;
  const t = String(text);
  return (
    /\b(not|isn'?t|aren'?t|wasn'?t|weren'?t|ain'?t)\s+(just\s+)?[a-z][^.,;:]{1,70}[,;]\s+(it'?s|it’s|that'?s|but\b|they'?re|you'?re|it\s+is|that\s+is|they\s+are|you\s+are)/i.test(t) ||
    /\b(this|that|it)\s+(is|was)\s+not\b[^.?!]*[.?!]+\s+(this|that|it)\s+(is|was)\b/i.test(t) ||
    /\b(this|that|it)\s+(isn'?t|is\s?n'?t)\b[^.?!]*[.?!]+\s+(this|that|it)\s+(is|was|'?s)\b/i.test(t) ||
    /\bsit(ting)?\s+with\b/i.test(t) ||
    /\blet\s+(it|that|this)\s+(sit|land|breathe)\b/i.test(t)
  );
}

export function scrubTells(text) {
  if (!text) return text;
  return text
    .replace(/\bworth sitting with\b/gi, 'worth remembering')
    .replace(/\bsit with (it|that|this)\b/gi, 'remember $1')
    .replace(/\blet\s+(it|that|this)\s+sit\b/gi, 'remember $1')
    .replace(/\blet\s+(it|that|this)\s+land\b/gi, 'remember $1')
    .replace(/\blet\s+(it|that|this)\s+breathe\b/gi, 'remember $1');
}
