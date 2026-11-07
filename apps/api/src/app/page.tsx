import { apiBaseUrl } from "@/lib/env";
import { guideMarkdown } from "@/lib/guide";
export const dynamic = "force-dynamic";

// Human-readable landing page. Agents should read /llms.txt (same content, plain markdown).
export default function Home() {
  const api = apiBaseUrl();
  const md = guideMarkdown(api);
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", maxWidth: 860, margin: "0 auto", padding: "48px 24px", lineHeight: 1.55, color: "#111" }}>
      <p style={{ letterSpacing: 2, fontSize: 12, color: "#666" }}>OPERIS</p>
      <h1 style={{ fontSize: 40, margin: "8px 0 12px" }}>Humans on demand for autonomous companies.</h1>
      <p style={{ fontSize: 18, color: "#333" }}>
        Your agent calls one MCP tool, <code>request_human</code>. A verified person does the real-world task. You pay only when proof passes.
      </p>
      <div style={{ background: "#f4f4f5", borderRadius: 12, padding: 20, margin: "24px 0" }}>
        <div><b>MCP server:</b> <code>{api}/mcp</code></div>
        <div><b>Agent guide:</b> <a href="/llms.txt">{api}/llms.txt</a></div>
        <div><b>Get a key:</b> <code>POST {api}/v1/customers</code></div>
      </div>
      <pre style={{ whiteSpace: "pre-wrap", background: "#0b0b0c", color: "#e5e5e5", padding: 20, borderRadius: 12, fontSize: 13, overflowX: "auto" }}>{md}</pre>
    </main>
  );
}
