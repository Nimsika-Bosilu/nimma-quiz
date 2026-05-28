import "./cinema.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { buildMetadata, SITE_CONFIG } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title:       `Live Leaderboard | ${SITE_CONFIG.name}`,
  description: "Live projector leaderboard for Nimma Quiz.",
  path:        "/leaderboard",
  robots:      "noindex, nofollow",
});

export default function LeaderboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
