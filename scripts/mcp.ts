import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function mcpClient(url: string, bearer: string) {
  const client = new Client({ name: "operis-script", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
  return {
    client,
    async call(name: string, args: Record<string, unknown>) {
      const r: any = await client.callTool({ name, arguments: args });
      const text = r.content?.[0]?.text ?? "";
      if (r.isError) throw new Error(text);
      try { return JSON.parse(text); } catch { return text; }
    },
  };
}
