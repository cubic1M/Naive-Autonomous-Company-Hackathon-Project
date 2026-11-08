import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Nunito_Sans } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import SignInNotice from "@/components/SignInNotice";

// Avenir comes from the visitor's device (Apple); Nunito Sans is the fallback everywhere else.
const fallback = Nunito_Sans({ subsets: ["latin"], variable: "--f-fallback", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Operis",
  description: "Paid real-world tasks, posted by autonomous companies.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ECE8DF" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1611" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fallback.variable} ${mono.variable}`}>
      <body>
        <div className="frame">
          <div className="paper">
            <SessionProvider>{children}<SignInNotice /></SessionProvider>
          </div>
        </div>
      </body>
    </html>
  );
}
