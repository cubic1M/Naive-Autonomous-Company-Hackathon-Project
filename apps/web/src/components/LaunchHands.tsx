"use client";

// The robot and human hands as a fixed backdrop behind the launch page. On the beige hero they show
// in their halftone grey; wherever the dark green sections cover the screen they turn neon green, so
// the color change follows the beige/green line as it scrolls up. The robot arm reaches out as you
// scroll; when that line reaches the middle of the screen (exactly where the fingertips meet) they
// touch, a bright spark bursts, and a water ripple spreads from it across the whole visible page for
// a few seconds. The hands stay touching further down.
// The image is one still (public/intro/hands.jpg), shown as two clipped layers: the robot side moves,
// the human side stays. The spark drawn in the image is left out of both.
// Everything here is portalled to <body>: the page wrapper (.frame) gets the ripple filter, and a
// filtered element would otherwise capture these fixed layers.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BOUNDARY = 'section[aria-labelledby="launch-title"]'; // the beige hero; everything after it is dark green
const PAGE = ".frame"; // the page wrapper from app/layout.tsx
const BEIGE = "#ECE8DF";
const GREEN = "#17211A";
const SPARK_MS = 1400;

// Whole-page ripple: rings of displacement spreading from the spark, fading out.
const RIPPLE_MS = 2600;
const MAX_SHIFT = 46; // px, peak displacement at the start

// Ripple along the line itself: a wave travelling out from the spark, damped in time and distance.
const AMP = 16; // px, peak displacement
const WAVELENGTH = 230; // px
const SPEED = 650; // px/s, how fast the wavefront spreads
const BAND = AMP * 2 + 4; // height of the strip that redraws the line

/** A radial displacement map: concentric rings that push pixels outward and inward (R = x, G = y). */
function ringMap(size = 512, rings = 4): string {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - h) / h;
      const dy = (y - h) / h;
      const r = Math.hypot(dx, dy);
      let f = 0;
      // Strongest at the leading (outer) ring, calm at the center and past the edge.
      if (r < 1 && r > 0) f = Math.sin(2 * Math.PI * rings * r) * Math.sin(Math.PI * r) * Math.pow(r, 0.6);
      const i = (y * size + x) * 4;
      img.data[i] = 128 + 127 * (r ? (dx / r) * f : 0);
      img.data[i + 1] = 128 + 127 * (r ? (dy / r) * f : 0);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

function Layer({ variant }: { variant: "grey" | "neon" }) {
  return (
    <div className={`hands-bg__layer hands-bg__layer--${variant}`}>
      <div className="hands-bg__stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/intro/hands.jpg" alt="" width={1706} height={795} className="hands-bg__img hands-bg__robot" decoding="async" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/intro/hands.jpg" alt="" width={1706} height={795} className="hands-bg__img hands-bg__human" decoding="async" />
      </div>
    </div>
  );
}

function RippleFilter({ id }: { id: string }) {
  return (
    <filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB" x="0" y="0" width="1" height="1">
      <feFlood floodColor="rgb(128,128,128)" result="neutral" />
      <feImage preserveAspectRatio="none" result="rings" />
      <feComposite in="rings" in2="neutral" operator="over" result="map" />
      <feDisplacementMap in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
}

export default function LaunchHands() {
  const [mounted, setMounted] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<SVGSVGElement>(null);
  const defs = useRef<SVGSVGElement>(null);
  const [spark, setSpark] = useState(0); // bumping the key replays the spark animation
  const [k, setK] = useState(1);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const el = root.current;
    const svg = strip.current;
    const hero = document.querySelector<HTMLElement>(BOUNDARY);
    const page = document.querySelector<HTMLElement>(PAGE);
    if (!el || !svg || !hero || !page || !defs.current) return;
    const beige = svg.querySelector<SVGPathElement>("[data-beige]")!;
    const green = svg.querySelector<SVGPathElement>("[data-green]")!;
    const pageFilter = defs.current.querySelector<SVGFilterElement>("#ripple-page")!;
    const fixedFilter = defs.current.querySelector<SVGFilterElement>("#ripple-fixed")!;
    const fixedEls = [...document.querySelectorAll<HTMLElement>(".hands-bg__layer"), svg as unknown as HTMLElement];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let wave = 0;
    let waveStart = 0;
    let touched = false;
    let mapUrl = "";

    // Point a ripple filter at the visible screen, in the coordinates of the element it's applied to.
    const aim = (f: SVGFilterElement, ox: number, oy: number, t: number) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const ease = 1 - Math.pow(1 - t, 2.2);
      const size = (0.12 + 1.9 * ease) * Math.hypot(vw, vh);
      const cx = vw / 2 + ox;
      const cy = vh / 2 + oy;
      f.setAttribute("x", String(ox));
      f.setAttribute("y", String(oy));
      f.setAttribute("width", String(vw));
      f.setAttribute("height", String(vh));
      const im = f.querySelector("feImage")!;
      im.setAttribute("href", mapUrl);
      im.setAttribute("x", String(cx - size / 2));
      im.setAttribute("y", String(cy - size / 2));
      im.setAttribute("width", String(size));
      im.setAttribute("height", String(size));
      f.querySelector("feDisplacementMap")!.setAttribute("scale", (MAX_SHIFT * 2 * Math.pow(1 - t, 1.6)).toFixed(2));
    };

    // Redraw the line as a wave: beige above the curve, dark green below it.
    const drawLine = (sec: number) => {
      const r = hero.getBoundingClientRect();
      const w = r.width;
      const cx = window.innerWidth / 2 - r.left;
      svg.style.left = `${r.left}px`;
      svg.style.width = `${w}px`;
      svg.style.top = `${r.bottom - BAND / 2}px`;
      svg.setAttribute("viewBox", `0 0 ${w} ${BAND}`);
      const kx = (2 * Math.PI) / WAVELENGTH;
      const front = SPEED * sec;
      const decay = Math.exp(-sec * 1.4);
      const pts: string[] = [];
      for (let x = 0; x <= w + 4; x += 4) {
        const dist = Math.abs(x - cx);
        const env = dist <= front ? decay * Math.exp(-dist / 700) * Math.min(1, (front - dist) / 90) : 0;
        const y = BAND / 2 - AMP * env * Math.sin(kx * (front - dist)); // crests ride outward with the front
        pts.push(`${Math.min(x, w).toFixed(1)},${y.toFixed(2)}`);
      }
      beige.setAttribute("d", `M0,0 L${w},0 L${[...pts].reverse().join(" L")} Z`);
      green.setAttribute("d", `M${pts.join(" L")} L${w},${BAND} L0,${BAND} Z`);
    };

    const stopRipple = () => {
      cancelAnimationFrame(wave);
      page.style.removeProperty("filter");
      fixedEls.forEach((x) => x.style.removeProperty("filter"));
      svg.style.display = "none";
    };
    const frame = (now: number) => {
      const t = Math.min(1, (now - waveStart) / RIPPLE_MS);
      const pr = page.getBoundingClientRect();
      aim(pageFilter, -pr.left, -pr.top, t);
      aim(fixedFilter, 0, 0, t);
      drawLine((now - waveStart) / 1000);
      if (t < 1) wave = requestAnimationFrame(frame);
      else stopRipple();
    };
    const startRipple = () => {
      if (reduce) return;
      if (!mapUrl) mapUrl = ringMap();
      cancelAnimationFrame(wave);
      waveStart = performance.now();
      svg.style.display = "block";
      frame(waveStart);
      page.style.filter = "url(#ripple-page)";
      fixedEls.forEach((x) => (x.style.filter = "url(#ripple-fixed)"));
      wave = requestAnimationFrame(frame);
    };

    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      const line = hero.getBoundingClientRect().bottom; // the beige/green line, in viewport px
      // Reach progress: 0 at the top of the page, 1 when the line reaches the middle of the screen.
      const travel = Math.max(1, window.scrollY + line - vh / 2);
      const p = Math.min(1, Math.max(0, window.scrollY / travel));
      el.style.setProperty("--line", `${Math.min(vh, Math.max(0, line))}px`);
      el.style.setProperty("--p", p.toFixed(4));
      const nowTouched = p >= 1;
      if (nowTouched && !touched && window.scrollY > 0) {
        setSpark((n) => n + 1);
        startRipple();
      }
      touched = nowTouched;
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const size = () => {
      setK(Math.max(0.6, Math.min(1.25, window.innerWidth / 1440)));
      queue();
    };
    size();
    update();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", size);
    return () => {
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", size);
      cancelAnimationFrame(raf);
      stopRipple();
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div ref={root} className="hands-bg" aria-hidden="true">
      <svg ref={defs} width="0" height="0" style={{ position: "absolute" }} focusable="false">
        {/* Dark dots on white paper -> neon green dots on black (black disappears under screen blending). */}
        <filter id="hands-neon" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="-0.0476 -0.1602 -0.0162 0 0.224
                    -0.2126 -0.7152 -0.0722 0 1
                    -0.0166 -0.0558 -0.0056 0 0.078
                     0       0       0      0 1"
          />
        </filter>
        <RippleFilter id="ripple-page" />
        <RippleFilter id="ripple-fixed" />
      </svg>
      <Layer variant="grey" />
      <Layer variant="neon" />
      <svg ref={strip} className="hands-bg__ripple" preserveAspectRatio="none" height={BAND}>
        <path data-beige="" fill={BEIGE} />
        <path data-green="" fill={GREEN} />
      </svg>
      {spark > 0 && (
        <div key={spark} className="hands-bg__spark" style={{ "--spark-ms": `${SPARK_MS}ms`, "--k": k } as React.CSSProperties}>
          <span className="hands-bg__halo" />
          <span className="hands-bg__flash" />
          <span className="hands-bg__core" />
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="hands-bg__ray" style={{ "--a": `${i * 30 + (i % 2) * 8}deg`, "--d": `${110 + (i % 3) * 44}px` } as React.CSSProperties} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
