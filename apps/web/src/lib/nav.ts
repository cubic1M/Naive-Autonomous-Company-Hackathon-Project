/** Only same-site paths are allowed as a post-login destination. */
export function safeNext(n: string | null | undefined, fallback = "/jobs") {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : fallback;
}
