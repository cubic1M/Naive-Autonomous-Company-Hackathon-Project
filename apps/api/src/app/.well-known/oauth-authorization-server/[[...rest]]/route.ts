// RFC 8414 authorization server metadata.
import { authServerMetadata, json, preflight, publicOrigin } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => json(authServerMetadata(publicOrigin(req)));
export const OPTIONS = preflight;
