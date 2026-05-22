import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nimma Quiz",
  description: "Live quiz competition app with QR join, editable MCQs, sessions, and realtime leaderboard."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
