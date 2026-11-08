// The one-prompt quick start for agents that can make web requests (Claude Code, Codex, Cursor agent,
// Naïve and custom agents). Tested blind; see docs/TEST_PLAN.md §3.
export function quickStartPrompt(opts: { email?: string; company?: string; task?: string } = {}) {
  const email = opts.email?.trim() || "<your email>";
  const company = opts.company?.trim() || "<your company>";
  const task = opts.task?.trim() || "<the task: what, where (address in San Francisco), budget in USD, deadline>";
  return `Set up Operis for us and use it.
1. Read https://operis.live/llms.txt and follow "If you're an AI agent: set yourself up".
2. Sign us up as "${company}" with my email ${email}.
3. Save the API key as the OPERIS_API_KEY environment variable (never in a shared file), and add Operis as an MCP server for future sessions if you can.
4. Then hire someone to: ${task}
5. If the result has a payment link (escrow_url), give it to me to pay once, then check the job until it's done.`;
}
