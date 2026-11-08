/** Distance in meters between two lat/lng points (haversine). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** The service area for on-site work (GEOFENCE_LAT/LNG/RADIUS_M). Defaults: downtown San Francisco, 8 km. */
export function serviceArea(): { lat: number; lng: number; radiusM: number } {
  return {
    lat: Number(process.env.GEOFENCE_LAT ?? 37.7749),
    lng: Number(process.env.GEOFENCE_LNG ?? -122.4194),
    radiusM: Number(process.env.GEOFENCE_RADIUS_M ?? 8000),
  };
}

/** Is the point inside the service area? */
export function inServiceArea(lat: number, lng: number): boolean {
  const c = serviceArea();
  return distanceM(lat, lng, c.lat, c.lng) <= c.radiusM;
}

/** Longest address we read. Longer is rejected, which also bounds the work done on caller-supplied text. */
export const MAX_ADDRESS_LENGTH = 300;
/** Words that say the caller doesn't know the spot, or that it isn't one spot. */
const VAGUE_WORDS = new Set(["unknown", "locate", "find", "tbd", "tba", "tbc", "confirm", "any", "nearest", "within", "blocks", "somewhere", "anywhere"]);
const VAGUE_PHRASES = ["look up", "to be determined", "worker to"];
/** Words that make "<number> ... <word>" a street address: "1 Ferry Building", "420 22nd St", "One Market Plaza". */
const STREET_WORDS = new Set([
  "st", "street", "ave", "av", "avenue", "blvd", "boulevard", "rd", "road", "way", "dr", "drive", "ln", "lane", "pl", "place",
  "plz", "plaza", "ct", "court", "ter", "terrace", "hwy", "highway", "sq", "square", "aly", "alley", "pkwy", "parkway", "cir",
  "circle", "row", "walk", "building", "bldg", "center", "centre", "embarcadero", "broadway", "pier", "wharf", "park",
]);
const NUMBER_WORDS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);
const COUNTRY_PARTS = new Set(["usa", "us", "u.s.", "u.s.a.", "united states", "united states of america"]);

const words = (text: string) =>
  text.toLowerCase().split(/[\s,]+/).map((w) => w.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9.]+$/, "").replace(/\.$/, "")).filter(Boolean);

/**
 * Is this an address a worker can walk to? On-site proof is checked against the job's pin, so the address must
 * name one spot: a street address ("1 Ferry Building, San Francisco, CA 94111", "Pier 70") or an intersection
 * ("Haight St & Ashbury St", "24th and Mission"). A city or ZIP alone, a note in brackets, or "any of the 3
 * Safeway stores" is not.
 */
export function isStreetAddress(address: string): boolean {
  if (address.length > MAX_ADDRESS_LENGTH) return false;
  // Notes in brackets and 5-digit ZIPs are never the street number.
  const cleaned = address.replace(/\([^()]*\)/g, " ").replace(/\b\d{5}(-\d{4})?\b/g, " ");
  const lower = cleaned.toLowerCase();
  if (VAGUE_PHRASES.some((p) => lower.includes(p))) return false;
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  while (parts.length > 0 && COUNTRY_PARTS.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  const all = words(parts.join(" "));
  if (all.length === 0 || all.some((w) => VAGUE_WORDS.has(w))) return false;

  for (let i = 0; i < all.length; i++) {
    const w = all[i];
    const isNumber = /^\d{1,5}[a-z]?$/.test(w) || /^\d{1,5}-\d{1,5}$/.test(w) || NUMBER_WORDS.has(w);
    if (isNumber && all.slice(i + 1, i + 4).some((n) => STREET_WORDS.has(n))) return true;
    if (w === "pier" && /^\d{1,3}$/.test(all[i + 1] ?? "")) return true;
  }

  // An intersection: the first comma part is two short names joined by "&", "/" or "and".
  const sides = (parts[0] ?? "").split(/\s*(?:&|\/|\band\b)\s*/i).map((side) => words(side));
  return sides.length === 2 && sides.every((side) => side.length >= 1 && side.length <= 3);
}
