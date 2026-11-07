/**
 * Abuse filter for request_human. Deterministic rules first (fast, explainable).
 * Returns reject with a reason the caller sees, or allow.
 */
const RULES: { category: string; reason: string; patterns: RegExp[] }[] = [
  {
    category: "identity_proxy",
    reason: "We don't do identity work: no CAPTCHAs, verification codes, account sign-ups or logins, or posing as someone else.",
    patterns: [/captcha/i, /\b(otp|2fa|one[- ]time (code|password)|verification code|sms code)\b/i, /\b(sign ?up|create|open|register) (an |a )?(new )?account/i, /\blog ?in (as|to|for)\b/i, /\b(pretend|pose|impersonat|act as|present (yourself|themselves) as)\b/i],
  },
  {
    category: "credentials_payments",
    reason: "We don't handle other people's cards, bank logins, or ID documents.",
    patterns: [/\b(credit card|debit card|card number|cvv|bank (login|account password)|ssn|social security|passport|driver'?s licen[cs]e)\b/i],
  },
  {
    category: "surveillance",
    reason: "We don't do surveillance: no following or photographing specific people, entering private property, or recording private conversations.",
    patterns: [/\b(follow|track|stalk|tail)\b.*\b(person|him|her|them|someone)\b/i, /\bphotograph(ing)? (a |the )?(specific )?(person|him|her|someone)\b/i, /\brecord (a |the )?(private )?conversation/i, /\b(break|sneak) in/i, /\btrespass/i],
  },
  {
    category: "licensed_dangerous",
    reason: "We don't take licensed or dangerous work (electrical, medical, legal advice, driving for hire, permitted work).",
    patterns: [/\b(electrical wiring|rewire|medical (advice|procedure)|prescri|legal advice|drive (me|passengers)|rideshare|weapon|firearm|drugs?)\b/i],
  },
  {
    category: "signing",
    reason: "Workers never sign contracts, leases or filings on anyone's behalf.",
    patterns: [/\b(sign|execute|notari[sz]e) (the |a |our )?(contract|lease|agreement|filing|document)s? (for|on behalf|as)\b/i, /\bon (our|my|its) behalf\b.*\bsign/i],
  },
];

export type SafetyResult = { ok: true } | { ok: false; category: string; reason: string };

export function checkSafety(title: string, instructions: string): SafetyResult {
  const text = `${title}\n${instructions}`;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) return { ok: false, category: rule.category, reason: rule.reason };
  }
  return { ok: true };
}
