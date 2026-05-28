/**
 * lib/seo.ts
 * ──────────────────────────────────────────────────────────────
 * Central SEO configuration and metadata factory for Nimma Quiz.
 * Used by every page's `export const metadata` or generateMetadata().
 */
import type { Metadata } from "next";

/* ── Site-wide constants ──────────────────────────────────────────── */

export const SITE_CONFIG = {
  /** Canonical production origin — override with NEXT_PUBLIC_SITE_URL env var */
  siteUrl: (
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://nimsika-bosilu.github.io/nimma-quiz"
  ).replace(/\/$/, ""),

  /** basePath prefix for asset URLs */
  basePath: (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, ""),

  name:        "Nimma Quiz",
  tagline:     "Live Quiz Competition Platform",
  description:
    "Nimma Quiz is a real-time live quiz competition platform. " +
    "Students join via QR code, answer multiple-choice questions on their phones, " +
    "and compete on a cinematic leaderboard — like Kahoot but fully customisable.",

  /** Twitter / X handle (without @) */
  twitterHandle: "nimma_quiz",

  /** Default OpenGraph image (must be in /public) */
  ogImage: "/nimma-quiz/og-image.png",

  /** Keywords for meta keywords tag */
  keywords: [
    "live quiz",
    "realtime quiz",
    "quiz competition",
    "kahoot alternative",
    "university quiz",
    "MCQ quiz platform",
    "leaderboard",
    "Firebase quiz",
    "Nimma Quiz",
  ],

  /** JSON-LD author / publisher */
  author: "Nimsika Bosilu",
};

/* ── Metadata factory ─────────────────────────────────────────────── */

interface BuildMetadataOptions {
  title?: string;
  description?: string;
  path?: string;           // e.g. "/admin"
  robots?: string;         // e.g. "noindex, nofollow"
  ogImage?: string;
  keywords?: string[];
}

/**
 * buildMetadata()
 * Creates a complete Next.js Metadata object with:
 *  - title template
 *  - Open Graph (og:*)
 *  - Twitter Card
 *  - canonical URL
 *  - robots directive
 *  - verification tokens
 */
export function buildMetadata(opts: BuildMetadataOptions = {}): Metadata {
  const {
    title       = SITE_CONFIG.name,
    description = SITE_CONFIG.description,
    path        = "",
    robots      = "index, follow",
    ogImage     = SITE_CONFIG.ogImage,
    keywords    = SITE_CONFIG.keywords,
  } = opts;

  const canonicalUrl = `${SITE_CONFIG.siteUrl}${path}`;
  const fullOgImage  = ogImage.startsWith("http")
    ? ogImage
    : `${SITE_CONFIG.siteUrl}${ogImage}`;

  return {
    title: {
      default:  title,
      template: `%s | ${SITE_CONFIG.name}`,
    },
    description,
    keywords,
    authors: [{ name: SITE_CONFIG.author }],

    /* ── Robots ── */
    robots: {
      index:               !robots.includes("noindex"),
      follow:              !robots.includes("nofollow"),
      googleBot: {
        index:             !robots.includes("noindex"),
        follow:            !robots.includes("nofollow"),
        "max-image-preview":    "large",
        "max-snippet":          -1,
        "max-video-preview":    -1,
      },
    },

    /* ── Canonical ── */
    alternates: {
      canonical: canonicalUrl,
    },

    /* ── Open Graph ── */
    openGraph: {
      type:        "website",
      locale:      "en_US",
      url:         canonicalUrl,
      siteName:    SITE_CONFIG.name,
      title,
      description,
      images: [
        {
          url:    fullOgImage,
          width:  1200,
          height: 630,
          alt:    `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
        },
      ],
    },

    /* ── Twitter Card ── */
    twitter: {
      card:        "summary_large_image",
      title,
      description,
      site:        `@${SITE_CONFIG.twitterHandle}`,
      creator:     `@${SITE_CONFIG.twitterHandle}`,
      images:      [fullOgImage],
    },

    /* ── Verification tokens (set via env vars) ── */
    verification: {
      google: process.env.NEXT_PUBLIC_SEARCH_CONSOLE_VERIFICATION,
    },

    /* ── Other ── */
    applicationName: SITE_CONFIG.name,
    category:        "education",
    creator:         SITE_CONFIG.author,
    publisher:       SITE_CONFIG.author,
    metadataBase:    new URL(SITE_CONFIG.siteUrl),
  };
}

/* ── JSON-LD helpers ─────────────────────────────────────────────── */

/** WebApplication structured data (homepage) */
export function buildWebAppJsonLd() {
  return {
    "@context":          "https://schema.org",
    "@type":             "WebApplication",
    name:                SITE_CONFIG.name,
    description:         SITE_CONFIG.description,
    url:                 SITE_CONFIG.siteUrl,
    applicationCategory: "EducationalApplication",
    operatingSystem:     "Any",
    offers: {
      "@type":    "Offer",
      price:      "0",
      priceCurrency: "USD",
    },
    author: {
      "@type": "Person",
      name:    SITE_CONFIG.author,
    },
    featureList: [
      "Real-time multiplayer quiz",
      "QR code join",
      "Live leaderboard",
      "Multiple choice questions",
      "Cinematic projector view",
      "Firebase Firestore realtime",
    ],
  };
}

/** BreadcrumbList for inner pages */
export function buildBreadcrumbJsonLd(
  crumbs: Array<{ name: string; url: string }>
) {
  return {
    "@context":   "https://schema.org",
    "@type":      "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type":   "ListItem",
      position:  i + 1,
      name:      c.name,
      item:      c.url,
    })),
  };
}

/** FAQPage schema for the landing page */
export function buildFaqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type":    "FAQPage",
    mainEntity: [
      {
        "@type":          "Question",
        name:             "How do students join a Nimma Quiz session?",
        acceptedAnswer: {
          "@type": "Answer",
          text:    "Students scan a QR code displayed on the projector screen or navigate to the session URL and enter their name and index number.",
        },
      },
      {
        "@type":          "Question",
        name:             "Is Nimma Quiz free to use?",
        acceptedAnswer: {
          "@type": "Answer",
          text:    "Yes, Nimma Quiz is completely free and open source. It runs on Firebase Firestore's free tier.",
        },
      },
      {
        "@type":          "Question",
        name:             "Can I customise the quiz questions?",
        acceptedAnswer: {
          "@type": "Answer",
          text:    "Yes. The admin panel lets you create, edit, and manage multiple quiz sets with multiple-choice questions, optional images, and difficulty levels.",
        },
      },
    ],
  };
}
