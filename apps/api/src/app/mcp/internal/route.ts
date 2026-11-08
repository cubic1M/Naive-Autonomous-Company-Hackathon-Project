// Internal MCP server for OUR Naïve agents. Each agent is only *allowed* its own tools (agents/agents.json).
import { serveMcp } from "@/mcp/server";
import { authInternal } from "@/lib/auth";
import { makeContext } from "@/tools/context";
import { INTERNAL_TOOLS, resolveTool } from "@/tools/registry";
import { MONEY_EXTRA_TOOLS } from "@/tools/money";
import { LIABILITY_EXTRA_TOOLS, requireLiabilityDecision } from "@/tools/liability";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  if (!authInternal(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const ctx = makeContext();
  const tools: Record<string, (args: any) => Promise<unknown>> = Object.fromEntries(
    INTERNAL_TOOLS.map((name) => [name, async (args: any) => {
      // Ops waits for Compliance: no outreach before the job's liability model is recorded.
      if ((name === "find_people" || name === "send_blast") && args?.job_id) await requireLiabilityDecision(args.job_id);
      const { impl, source } = resolveTool(name);
      ctx.log(`${name} [${source}]`, JSON.stringify(args).slice(0, 200));
      return impl(args, ctx);
    }]),
  );
  for (const [name, impl] of Object.entries(MONEY_EXTRA_TOOLS)) tools[name] = (args: any) => impl(args, ctx);
  for (const [name, impl] of Object.entries(LIABILITY_EXTRA_TOOLS)) tools[name] = (args: any) => impl(args, ctx);
  return serveMcp(req, "operis-internal", tools);
}
export { handle as GET, handle as POST, handle as DELETE };
