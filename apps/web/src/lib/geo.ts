export type Fix = { lat: number; lng: number; accuracy: number; at: number };

export type GeoError = "denied" | "unavailable" | "timeout" | "unsupported" | "insecure";

/** One high-accuracy GPS fix. Rejects with a GeoError the UI can explain. */
export function getFix(timeoutMs = 20_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && !window.isSecureContext) return reject("insecure" satisfies GeoError);
    if (!("geolocation" in navigator)) return reject("unsupported" satisfies GeoError);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp }),
      (e) => reject((e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable") satisfies GeoError),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 },
    );
  });
}

export const GEO_HELP: Record<GeoError, string> = {
  denied:
    "Location is blocked for this site. We need it to confirm the photos were taken at the job; without it the proof can't be approved and you won't be paid. Turn it on in your browser's site settings (on iPhone: Settings › Privacy › Location Services › Safari Websites › While Using), then try again.",
  unavailable: "Your phone couldn't find its location. Step outside or near a window, make sure Location is on, and try again.",
  timeout: "Finding your location is taking too long. Step outside for a clearer view of the sky and try again.",
  unsupported: "This browser can't share your location. Open the link in Safari or Chrome.",
  insecure: "Location only works on a secure (https) page. Open the link exactly as we sent it.",
};
