// "Give this to your agent": a very short command is shown; Copy puts a fuller instruction on the
// clipboard (Monid-style). The agent reads https://operis.live/SKILL.md and sets itself up.
export const SKILL_URL = "https://operis.live/SKILL.md";
export const SHOWN_COMMAND = `set up ${SKILL_URL}`;

export function copiedInstruction() {
  return `Set up ${SKILL_URL} first if Operis isn't set up yet: follow its setup steps, and if they need my email or a browser sign-in, ask me. Then use Operis whenever a task needs a real person: photographing or checking a place, picking up and shipping something, or paperwork in San Francisco, or a quick expert check online. If a job comes back with a payment link, give it to me to pay once.`;
}

// Kept for tests and older callers: the long, fill-in-the-blanks variant.
export function quickStartPrompt(opts: { email?: string; company?: string; task?: string } = {}) {
  const extra = [opts.company && `Company: ${opts.company}.`, opts.email && `My email: ${opts.email}.`, opts.task && `Then hire someone to: ${opts.task}`].filter(Boolean).join(" ");
  return extra ? `${copiedInstruction()} ${extra}` : copiedInstruction();
}
