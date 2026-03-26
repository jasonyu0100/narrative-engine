import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { Providers } from "./providers";
import { LandingTopbar } from "@/components/landing/LandingTopbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "InkTide",
  description: "Where narrative forces rise and fall like tides. Generate and revise stories guided by computable structure.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-bg-base text-text-primary`}
      >
        <Providers>
          <LandingTopbar />
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
