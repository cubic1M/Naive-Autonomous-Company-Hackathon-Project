import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SCHEMAS } from "./schemas";

type Handler = (args: any) => Promise<unknown>;

const text = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  // Naïve truncates tool results at 8,000 chars; stay well under.
  return s.length > 7000 ? s.slice(0, 7000) + "…(truncated)" : s;
};

/** Build a stateless MCP server exposing `tools` and answer one HTTP request with it. */
export async function serveMcp(req: Request, name: string, tools: Record<string, Handler>): Promise<Response> {
  const server = new McpServer({ name, version: "0.1.0" });
  for (const [tool, handler] of Object.entries(tools)) {
    const spec = SCHEMAS[tool as keyof typeof SCHEMAS];
    server.registerTool(tool, { description: spec.description, inputSchema: spec.shape as any }, async (args: any) => {
      try {
        const out = await handler(args);
        return { content: [{ type: "text" as const, text: text(out) }] };
      } catch (e: any) {
        console.error(`[mcp:${name}] ${tool} failed`, e);
        return { isError: true, content: [{ type: "text" as const, text: `Error: ${e?.message ?? String(e)}` }] };
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
