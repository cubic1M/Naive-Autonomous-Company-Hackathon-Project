"use client";

import { useEffect, useRef } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";

import type { DashJob } from "@/lib/api";

const SF: [number, number] = [37.7749, -122.4194];

const TONE: Record<string, string> = {
  outreach: "#3e5c5a",
  accepted: "#46664f",
  proof_submitted: "#8a5300",
  escalated: "#a12a22",
  approved: "#46664f",
  paid: "#1f2a22",
};

/** Leaflet touches window at import time, so it's loaded inside the effect. */
export default function JobsMap({ jobs, activeId }: { jobs: DashJob[]; activeId: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !el.current || map.current) return;
      L.current = mod;
      map.current = mod.map(el.current, { zoomControl: true, attributionControl: true }).setView(SF, 12);
      mod
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          className: "osm-tiles",
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
        .addTo(map.current);
      layer.current = mod.layerGroup().addTo(map.current);
      draw();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(draw, [jobs, activeId]);

  function draw() {
    const mod = L.current;
    if (!mod || !map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts: [number, number][] = [];
    for (const j of jobs) {
      if (j.lat == null || j.lng == null) continue;
      const active = j.id === activeId;
      const color = TONE[j.status] ?? "#8e958c";
      pts.push([j.lat, j.lng]);
      if (active) mod.circle([j.lat, j.lng], { radius: 150, color, weight: 1.5, fillOpacity: 0.12, dashArray: "4 4" }).addTo(layer.current);
      mod
        .circleMarker([j.lat, j.lng], { radius: active ? 10 : 6, color: "#fbf9f5", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(`${escapeHtml(j.title)} · ${j.status.replace(/_/g, " ")}`)
        .addTo(layer.current);
    }
    if (!fitted.current && pts.length) {
      fitted.current = true;
      map.current.fitBounds(mod.latLngBounds(pts).pad(0.3), { maxZoom: 14 });
    }
  }

  return <div ref={el} className="map" role="img" aria-label={`Map of ${jobs.length} recent jobs`} />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
