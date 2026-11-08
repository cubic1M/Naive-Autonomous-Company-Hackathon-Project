"use client";

// The robot and human hands as a fixed backdrop behind the launch page: halftone grey on the beige
// hero, neon green behind the dark sections, faint behind the footer. Both hands close in as you
// scroll; when the beige/green line reaches the middle of the screen (exactly where the fingertips
// meet) they touch, a bright spark bursts, and a water ripple spreads across the visible page.
//
// Each section draws its own copy of the hands (<HandsClip>): a `position: fixed` layer inside a
// container clipped to the section. The browser scrolls the clip with the page, so the grey/neon
// split always sits exactly on the section border, even when scrolling fast (nothing waits on JS).
// The image is one still (public/intro/hands.jpg), shown as two clipped halves: the robot side and
// the human side, which move independently. The spark drawn in the image is left out of both.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BOUNDARY = 'section[aria-labelledby="launch-title"]'; // the beige hero; the dark sections follow it
const SPARK_MS = 1400;

// Whole-page ripple: rings of displacement spreading from the spark, fading out.
const RIPPLE_MS = 2600;
const MAX_SHIFT = 46; // px, peak displacement at the start
const RIPPLE_MARGIN = 0.5; // extra viewport heights processed above and below, so a fast scroll never shows a blank edge

// Ripple along the beige/green line itself.
const AMP = 16; // px, peak displacement
const WAVELENGTH = 230; // px
const SPEED = 650; // px/s, how fast the wavefront spreads
const BAND = AMP * 2 + 4; // height of the strip that redraws the line
const BEIGE = "#ECE8DF";
const GREEN = "#17211A";

/** One section's copy of the hands. Put it first inside a section with `position: relative; isolation: isolate`. */
export function HandsClip({ variant, bg }: { variant: "grey" | "neon" | "dim"; bg: string }) {
  return (
    <div className="hands-clip" style={{ background: bg }} aria-hidden="true">
      <div className={`hands-bg__layer hands-bg__layer--${variant}`}>
        <div className="hands-bg__stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/intro/hands.jpg" alt="" width={1706} height={795} className="hands-bg__img hands-bg__robot" decoding="async" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/intro/hands.jpg" alt="" width={1706} height={795} className="hands-bg__img hands-bg__human" decoding="async" />
        </div>
      </div>
    </div>
  );
}

/** The strip that redraws the beige/green line as a wave. Put it at the top of the dark sections' wrapper. */
export function RippleLine() {
  return (
    <svg className="hands-bg__ripple" data-ripple-line="" preserveAspectRatio="none" height={BAND} style={{ top: -BAND / 2 }} aria-hidden="true">
      <path data-beige="" fill={BEIGE} />
      <path data-green="" fill={GREEN} />
    </svg>
  );
}

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

const SVG = "http://www.w3.org/2000/svg";

/** A displacement filter for one element; `aim()` points it at the visible screen. */
function makeFilter(defs: SVGSVGElement, id: string) {
  const f = document.createElementNS(SVG, "filter");
  f.setAttribute("id", id);
  f.setAttribute("filterUnits", "userSpaceOnUse");
  f.setAttribute("primitiveUnits", "userSpaceOnUse");
  f.setAttribute("color-interpolation-filters", "sRGB");
  const flood = document.createElementNS(SVG, "feFlood");
  flood.setAttribute("flood-color", "rgb(128,128,128)");
  flood.setAttribute("result", "neutral");
  const image = document.createElementNS(SVG, "feImage");
  image.setAttribute("preserveAspectRatio", "none");
  image.setAttribute("result", "rings");
  const comp = document.createElementNS(SVG, "feComposite");
  comp.setAttribute("in", "rings");
  comp.setAttribute("in2", "neutral");
  comp.setAttribute("operator", "over");
  comp.setAttribute("result", "map");
  const disp = document.createElementNS(SVG, "feDisplacementMap");
  disp.setAttribute("in", "SourceGraphic");
  disp.setAttribute("in2", "map");
  disp.setAttribute("xChannelSelector", "R");
  disp.setAttribute("yChannelSelector", "G");
  disp.setAttribute("scale", "0");
  f.append(flood, image, comp, disp);
  defs.append(f);
  return { f, image, disp };
}

export default function LaunchHands() {
  const [mounted, setMounted] = useState(false);
  const defs = useRef<SVGSVGElement>(null);
  const [spark, setSpark] = useState(0); // bumping the key replays the spark animation
  const [k, setK] = useState(1);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !defs.current) return;
    const hero = document.querySelector<HTMLElement>(BOUNDARY);
    const strip = document.querySelector<SVGSVGElement>("[data-ripple-line]");
    if (!hero) return;
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let wave = 0;
    let waveStart = 0;
    let touched = false;
    let mapUrl = "";
    let targets: { el: HTMLElement | SVGElement; f: ReturnType<typeof makeFilter> }[] = [];

    // What ripples: every section's content (not the hands containers) and each hands layer.
    const collect = () => {
      const els = [
        ...document.querySelectorAll<HTMLElement>(".launch > section > :not(.hands-clip), .launch > .hands-dark > section > :not(.hands-clip), .launch > footer > :not(.hands-clip)"),
        ...document.querySelectorAll<HTMLElement>(".launch .hands-bg__layer"),
      ];
      return els.map((el, i) => ({ el, f: makeFilter(defs.current!, `ripple-${i}`) }));
    };

    // Point one filter at the visible screen (plus a margin), in its element's own coordinates.
    const aim = ({ el, f }: (typeof targets)[number], t: number) => {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const m = vh * RIPPLE_MARGIN;
      const ease = 1 - Math.pow(1 - t, 2.2);
      const size = (0.12 + 1.9 * ease) * Math.hypot(vw, vh);
      const cx = vw / 2 - r.left;
      const cy = vh / 2 - r.top;
      f.f.setAttribute("x", String(-r.left));
      f.f.setAttribute("y", String(-r.top - m));
      f.f.setAttribute("width", String(vw));
      f.f.setAttribute("height", String(vh + 2 * m));
      f.image.setAttribute("href", mapUrl);
      f.image.setAttribute("x", String(cx - size / 2));
      f.image.setAttribute("y", String(cy - size / 2));
      f.image.setAttribute("width", String(size));
      f.image.setAttribute("height", String(size));
      f.disp.setAttribute("scale", (MAX_SHIFT * 2 * Math.pow(1 - t, 1.6)).toFixed(2));
    };

    // Redraw the line as a wave: beige above the curve, dark green below it.
    const drawLine = (sec: number) => {
      if (!strip) return;
      const w = strip.parentElement!.getBoundingClientRect();
      const width = w.width;
      const cx = window.innerWidth / 2 - w.left;
      strip.setAttribute("viewBox", `0 0 ${width} ${BAND}`);
      const kx = (2 * Math.PI) / WAVELENGTH;
      const front = SPEED * sec;
      const decay = Math.exp(-sec * 1.4);
      const pts: string[] = [];
      for (let x = 0; x <= width + 4; x += 4) {
        const dist = Math.abs(x - cx);
        const env = dist <= front ? decay * Math.exp(-dist / 700) * Math.min(1, (front - dist) / 90) : 0;
        const y = BAND / 2 - AMP * env * Math.sin(kx * (front - dist)); // crests ride outward with the front
        pts.push(`${Math.min(x, width).toFixed(1)},${y.toFixed(2)}`);
      }
      strip.querySelector("[data-beige]")!.setAttribute("d", `M0,0 L${width},0 L${[...pts].reverse().join(" L")} Z`);
      strip.querySelector("[data-green]")!.setAttribute("d", `M${pts.join(" L")} L${width},${BAND} L0,${BAND} Z`);
    };

    const stopRipple = () => {
      cancelAnimationFrame(wave);
      targets.forEach(({ el, f }) => {
        el.style.removeProperty("filter");
        f.f.remove();
      });
      targets = [];
      if (strip) strip.style.display = "none";
    };
    const frame = (now: number) => {
      const t = Math.min(1, (now - waveStart) / RIPPLE_MS);
      targets.forEach((x) => aim(x, t));
      drawLine((now - waveStart) / 1000);
      if (t < 1) wave = requestAnimationFrame(frame);
      else stopRipple();
    };
    const startRipple = () => {
      if (reduce) return;
      if (!mapUrl) mapUrl = ringMap();
      stopRipple();
      targets = collect();
      waveStart = performance.now();
      if (strip) strip.style.display = "block";
      frame(waveStart);
      targets.forEach(({ el, f }) => (el.style.filter = `url(#${f.f.id})`));
      wave = requestAnimationFrame(frame);
    };

    // Reach progress: 0 at the top of the page, 1 when the beige/green line reaches the middle of the
    // screen. Only the hands' slide uses it; the color split never waits on this.
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      const line = hero.getBoundingClientRect().bottom;
      const travel = Math.max(1, window.scrollY + line - vh / 2);
      const p = Math.min(1, Math.max(0, window.scrollY / travel));
      root.style.setProperty("--p", p.toFixed(4));
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
      root.style.removeProperty("--p");
    };
  }, [mounted]);

  return (
    <>
      <svg ref={defs} width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
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
      </svg>
      {mounted &&
        spark > 0 &&
        createPortal(
          <div key={spark} className="hands-bg__spark" style={{ "--spark-ms": `${SPARK_MS}ms`, "--k": k } as React.CSSProperties} aria-hidden="true">
            <span className="hands-bg__halo" />
            <span className="hands-bg__flash" />
            <span className="hands-bg__core" />
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className="hands-bg__ray" style={{ "--a": `${i * 30 + (i % 2) * 8}deg`, "--d": `${110 + (i % 3) * 44}px` } as React.CSSProperties} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
