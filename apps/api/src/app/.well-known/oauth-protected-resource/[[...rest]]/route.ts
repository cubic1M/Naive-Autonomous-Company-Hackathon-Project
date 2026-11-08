// RFC 9728 protected resource metadata (also served at /.well-known/oauth-protected-resource/mcp).
import { json, preflight, publicOrigin, resourceMetadata } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => json(resourceMetadata(publicOrigin(req)));
export const OPTIONS = preflight;
