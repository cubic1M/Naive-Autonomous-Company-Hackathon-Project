import { optional } from "./env";

const BASE = "https://api.monid.ai/v1";

async function call(path: string, body: unknown) {
  const key = optional("MONID_API_KEY");
  if (!key) throw new Error("MONID_API_KEY not set");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok && json?.status !== "BLOCKED") throw new Error(`Monid ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export const monid = {
  discover: (query: string) => call("/discover", { query }),
  inspect: (provider: string, endpoint: string) => call("/inspect", { provider, endpoint }),
  run: (provider: string, endpoint: string, input: unknown) => call("/run", { provider, endpoint, input }),
};
