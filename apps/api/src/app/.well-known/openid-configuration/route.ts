// Some MCP clients look here first; same metadata as oauth-authorization-server.
import { authServerMetadata, json, preflight, publicOrigin } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => json(authServerMetadata(publicOrigin(req)));
export const OPTIONS = preflight;
