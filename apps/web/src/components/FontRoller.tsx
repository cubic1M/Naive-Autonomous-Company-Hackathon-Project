"use client";

// "real people" in the launch headline, typed out like a typewriter in one hand-drawn font, held
// with a blinking cursor, deleted quickly, then typed again in the next font. Every finished version
// sits invisibly in the same grid cell, so the box keeps the widest width and a steady baseline and
// the words around it never shift.
import { useEffect, useState } from "react";
import { Corinthia, Gochi_Hand, Mynerve, Reenie_Beanie, Sue_Ellen_Francisco, Zeyada } from "next/font/google";

// preload: false — these only load on the page that uses them.
const gochi = Gochi_Hand({ subsets: ["latin"], weight: "400", preload: false, display: "swap" });
const mynerve = Mynerve({ subsets: ["latin"], weight: "400", preload: false, display: "swap" });
const reenie = Reenie_Beanie({ subsets: ["latin"], weight: "400", preload: false, display: "swap" });
const zeyada = Zeyada({ subsets: ["latin"], weight: "400", preload: false, display: "swap" });
const corinthia = Corinthia({ subsets: ["latin"], weight: "400", preload: false, display: "swap" });
const sueEllen = Sue_Ellen_Francisco({ subsets: ["latin"], weight: "400", preload: false, display: "swap" });

// Each font's size relative to the headline, so they all match the height of the words beside them.
const FONTS = [
  { family: gochi.style.fontFamily, scale: 1.05 },
  { family: mynerve.style.fontFamily, scale: 1 },
  { family: reenie.style.fontFamily, scale: 1.35 },
  { family: zeyada.style.fontFamily, scale: 1.25 },
  { family: corinthia.style.fontFamily, scale: 1.45 },
  { family: sueEllen.style.fontFamily, scale: 1 },
];

// Timing (ms)
const EMPTY_PAUSE = 450; // blank, cursor blinking, before typing
const TYPE_STEP = 45; // per letter while typing
const BLINK = 700; // one cursor blink (on + off); keep in step with roller-blink in globals.css
const HOLD = BLINK * 3; // finished word: the cursor blinks three times, then it deletes
const DELETE_STEP = TYPE_STEP; // per letter while deleting: same speed as typing

type Phase = "empty" | "typing" | "hold" | "deleting";

export default function FontRoller({ text = "real people" }: { text?: string }) {
  const [font, setFont] = useState(0);
  const [shown, setShown] = useState(text.length); // start fully typed (also the reduced-motion and no-JS view)
  const [phase, setPhase] = useState<Phase>("hold");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let t: number | undefined;
    if (phase === "empty") t = window.setTimeout(() => setPhase("typing"), EMPTY_PAUSE);
    else if (phase === "typing") {
      if (shown < text.length) t = window.setTimeout(() => setShown((n) => n + 1), TYPE_STEP);
      else setPhase("hold");
    } else if (phase === "hold") t = window.setTimeout(() => setPhase("deleting"), HOLD);
    else if (shown > 0) t = window.setTimeout(() => setShown((n) => n - 1), DELETE_STEP);
    else {
      setFont((f) => (f + 1) % FONTS.length);
      setPhase("empty");
    }
    return () => window.clearTimeout(t);
  }, [phase, shown, text.length]);

  const f = FONTS[font]!;
  // The cursor blinks while waiting and stays solid while letters are being typed or deleted.
  const blinking = phase === "empty" || phase === "hold";

  return (
    <span className="font-roller" aria-label={text} role="text">
      {/* Every finished version, invisible, in one grid cell: the widest width and a steady baseline. */}
      {FONTS.map((g, i) => (
        <span key={i} className="font-roller__ghost" aria-hidden="true" style={{ fontFamily: g.family, fontSize: `${g.scale}em`, lineHeight: 1 / g.scale }}>
          {text}
        </span>
      ))}
      <span className="font-roller__typed" aria-hidden="true">
        <span style={{ fontFamily: f.family, fontSize: `${f.scale}em`, lineHeight: 1 / f.scale }}>{text.slice(0, shown)}</span>
        <span className={`font-roller__cursor${blinking ? " is-blinking" : ""}`} />
      </span>
    </span>
  );
}
