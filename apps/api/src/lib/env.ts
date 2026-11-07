export function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env var ${key}`);
  return v;
}
export function optional(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === "" ? undefined : v;
}
export function flag(key: string): boolean {
  return ["1", "true", "yes", "on"].includes((process.env[key] ?? "").toLowerCase());
}
export function list(key: string): string[] {
  return (process.env[key] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
/** Dora's web app (worker job links: {PUBLIC_BASE_URL}/j/{token}). Same meaning as in services/outreach. */
export const baseUrl = () => (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
/** This API itself (MCP URL, webhooks). */
export const apiBaseUrl = () => (process.env.API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
