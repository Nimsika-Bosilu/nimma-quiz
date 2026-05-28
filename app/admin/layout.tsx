/**
 * app/admin/layout.tsx
 * ──────────────────────────────────────────────────────────────
 * Segment-level metadata for /admin.
 * Sets noindex + nofollow so the private admin dashboard is never
 * indexed by search engines, regardless of root layout settings.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { buildMetadata, SITE_CONFIG } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title:       `Admin Dashboard | ${SITE_CONFIG.name}`,
  description: "Nimma Quiz admin dashboard — create quiz sessions, manage questions, and control the live projector view.",
  path:        "/admin",
  robots:      "noindex, nofollow",
});

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
