// Stroke icons from the Operis design (24×24, currentColor).
const PATHS: Record<string, React.ReactNode> = {
  pin: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  shield: <><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></>,
  badge: <><circle cx="12" cy="9" r="5" /><path d="M9 13.5L7.5 21l4.5-2.5 4.5 2.5-1.5-7.5" /></>,
  satellite: <><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" /></>,
  message: <path d="M4 5h16v11H8l-4 4z" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  arrowLeft: <path d="M15 6l-6 6 6 6" />,
  signal: <path d="M4 20v-3M9 20v-7M14 20v-11M19 20V4" />,
  hourglass: <path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9" />,
  bank: <><path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  wave: <path d="M5 12h14M13 6l6 6-6 6" />,
};

export default function Icon({ name, size = 20, stroke = 2, className, style }: { name: keyof typeof PATHS; size?: number; stroke?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={{ flex: "none", ...style }}>
      {PATHS[name]}
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 34 34" aria-hidden="true">
      <rect width="34" height="34" rx="8" fill="#1F2A22" />
      <circle cx="13.5" cy="17" r="6" fill="none" stroke="#ECE8DF" strokeWidth="2.4" />
      <circle cx="20.5" cy="17" r="6" fill="none" stroke="#A9C0A2" strokeWidth="2.4" />
    </svg>
  );
}
