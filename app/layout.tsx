import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Orbitron } from "next/font/google";
import "./globals.css";
import { buildMetadata, buildWebAppJsonLd, buildFaqJsonLd, SITE_CONFIG } from "@/lib/seo";
import { GA_MEASUREMENT_ID } from "@/lib/gtag";

/* ── Fonts ──────────────────────────────────────────────────────── */

/**
 * Inter — primary body / UI font.
 * Replaces the previous Outfit import for broader glyph support.
 */
const inter = Inter({
  subsets:  ["latin"],
  variable: "--font-inter",
  display:  "swap",
  preload:  true,
});

/**
 * Orbitron — display font for the projector leaderboard.
 * Loaded at root level so Next.js can preconnect and preload it once.
 */
const orbitron = Orbitron({
  subsets:  ["latin"],
  variable: "--font-orbitron",
  display:  "swap",
  preload:  false,   // Only critical on /leaderboard; defer elsewhere
  weight:   ["400", "700", "900"],
});

/* ── Root metadata ──────────────────────────────────────────────── */

export const metadata: Metadata = buildMetadata({
  title:       SITE_CONFIG.name,
  description: SITE_CONFIG.description,
  path:        "",
  robots:      "index, follow",
});

/* ── Layout ─────────────────────────────────────────────────────── */

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${orbitron.variable}`}
    >
      <head>
        <meta charSet="utf-8" />

        {/* Preconnect to Firebase & Google Fonts (speed) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        {/* Favicon / PWA icons */}
        <link rel="icon"             href={`${SITE_CONFIG.basePath}/favicon.ico`} />
        <link rel="apple-touch-icon" href={`${SITE_CONFIG.basePath}/apple-touch-icon.png`} />
        <link rel="manifest"         href={`${SITE_CONFIG.basePath}/site.webmanifest`} />

        {/* Theme colour (projector dark mode) */}
        <meta name="theme-color" content="#070711" />
        <meta name="color-scheme" content="dark light" />

        {/* JSON-LD — WebApplication schema */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildWebAppJsonLd()) }}
        />

        {/* JSON-LD — FAQ schema */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqJsonLd()) }}
        />
      </head>

      <body className={inter.className}>
        {children}

        {/* ── Google Analytics 4 ────────────────────────────────────
            Only injected when NEXT_PUBLIC_GA_ID is set.
            strategy="afterInteractive" defers until hydration is done
            so it never blocks the realtime quiz UI.
        ─────────────────────────────────────────────────────────── */}
        {GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}', {
                  page_path: window.location.pathname,
                  anonymize_ip: true,
                  cookie_flags: 'SameSite=None;Secure'
                });
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
