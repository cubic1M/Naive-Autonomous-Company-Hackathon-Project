// Brand the Operis organization in Naïve's studio: the ring logo (SVG, Naïve's allow-list: shapes only) and the brand
// kit (palette, typeface, tagline) that Naïve agents read when they make things in our look.
//   npx tsx agents/brand.ts            dry run: prints what it would set
//   npx tsx agents/brand.ts --apply    PATCH /v1/organizations/{id}
import { readFileSync, existsSync } from "node:fs";

const env = existsSync("apps/api/.env.local") ? readFileSync("apps/api/.env.local", "utf8") : "";
const KEY = process.env.NAIVE_API_KEY ?? env.match(/^NAIVE_API_KEY=(.*)$/m)?.[1]?.replace(/"/g, "");
const NAIVE = "https://api.vetta.sh/v1";
if (!KEY) throw new Error("NAIVE_API_KEY not set");

// Same mark as operis.live (apps/web/src/components/SiteHeader.tsx Logo): two linked rings on forest green.
export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34">' +
  '<title>Operis</title>' +
  '<rect width="34" height="34" rx="8" fill="#1f2a22"/>' +
  '<circle cx="13.5" cy="17" r="6" fill="none" stroke="#ece8df" stroke-width="2.4"/>' +
  '<circle cx="20.5" cy="17" r="6" fill="none" stroke="#a9c0a2" stroke-width="2.4"/>' +
  "</svg>";

export const BRAND = {
  palette: [
    { name: "Forest", hex: "#2f4a37" },
    { name: "Sage", hex: "#46664f" },
    { name: "Mint", hex: "#a9c0a2" },
    { name: "Paper", hex: "#ece8df" },
    { name: "Ink", hex: "#17211a" },
  ],
  typeface: "grotesk", // operis.live uses Avenir: closest of grotesk | serif | rounded | mono
  tagline: "Humans on demand for autonomous companies.",
};

console.log("logo_svg:", LOGO_SVG);
console.log("brand:", JSON.stringify(BRAND));
if (!process.argv.includes("--apply")) { console.log("\nDry run. Re-run with --apply."); process.exit(0); }

const orgs = await (await fetch(`${NAIVE}/organizations`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
const org = (orgs.data ?? [])[0];
if (!org) throw new Error("no organization visible to this key");
const r = await fetch(`${NAIVE}/organizations/${org.id}`, {
  method: "PATCH", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ logo_svg: LOGO_SVG, brand: BRAND }),
});
const j: any = await r.json();
if (!r.ok) throw new Error(`PATCH organization → ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
console.log(`✓ ${j.name}: logo and brand kit set`);
