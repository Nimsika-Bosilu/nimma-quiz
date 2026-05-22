import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";

const roboto = Roboto({ 
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-roboto"
});

export const metadata: Metadata = {
  title: "Nimma Quiz",
  description: "Live quiz competition app with QR join, editable MCQs, sessions, and realtime leaderboard."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body>{children}</body>
    </html>
  );
}
