import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SCHEMAS } from "./schemas";
import { GROWTH_SCHEMAS } from "./growthSchemas";
import { describeToolError } from "../../../../services/money-verification/src/tools";

// Every served tool needs a schema entry; the growth tools' entries live in growthSchemas.ts.
const ALL_SCHEMAS: Record<string, { description: string; shape: unknown } | undefined> = { ...SCHEMAS, ...GROWTH_SCHEMAS };

type Handler = (args: any) => Promise<unknown>;

const text = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  // Naïve truncates tool results at 8,000 chars; stay well under.
  return s.length > 7000 ? s.slice(0, 7000) + "…(truncated)" : s;
};

/** Build a stateless MCP server exposing `tools` and answer one HTTP request with it. */
export async function serveMcp(req: Request, name: string, tools: Record<string, Handler>, instructions?: string): Promise<Response> {
  const server = new McpServer({ name, version: "0.1.0" }, instructions ? { instructions } : undefined);
  for (const [tool, handler] of Object.entries(tools)) {
    const spec = ALL_SCHEMAS[tool];
    if (!spec) throw new Error(`no MCP schema for tool ${tool}`);
    server.registerTool(tool, { description: spec.description, inputSchema: spec.shape as any }, async (args: any) => {
      try {
        const out = await handler(args);
        return { content: [{ type: "text" as const, text: text(out) }] };
      } catch (e: any) {
        console.error(`[mcp:${name}] ${tool} failed`, e);
        // code + message (e.g. requires_approval, idempotency_conflict) so agents can act on it
        const d = describeToolError(e);
        return { isError: true, content: [{ type: "text" as const, text: `Error (${d.code}): ${d.message}` }] };
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
