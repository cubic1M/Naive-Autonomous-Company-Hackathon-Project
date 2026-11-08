// Same type as operis.live: Avenir (Apple devices), Nunito Sans elsewhere.
const FONT = "'Avenir Next', Avenir, 'Nunito Sans', ui-sans-serif, system-ui, sans-serif";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&display=swap" />
      </head>
      <body style={{ fontFamily: FONT, margin: 0 }}>{children}</body>
    </html>
  );
}
