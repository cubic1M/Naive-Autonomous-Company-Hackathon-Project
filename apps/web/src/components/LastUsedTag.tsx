"use client";

// Small "Last used" tag next to the sign-in method this browser used last time.
import { useEffect, useState } from "react";
import { lastMethod } from "@/lib/signin";

export default function LastUsedTag({ method, dark = false }: { method: string; dark?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(lastMethod() === method), [method]);
  if (!on) return null;
  return (
    <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.02em", padding: "3px 8px", borderRadius: 999, background: dark ? "#2F3D33" : "#E2EADE", color: dark ? "#A9C0A2" : "#2F4A37", whiteSpace: "nowrap" }}>
      Last used
    </span>
  );
}
