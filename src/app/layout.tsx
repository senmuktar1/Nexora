import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXORA — Stellar Financial Terminal",
  description: "Discover, analyze, access and pay across the Stellar financial ecosystem with NEXORA.",
  applicationName: "NEXORA",
  icons: { icon: "/nexora-mark.svg" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0D1410"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><WalletProvider>{children}</WalletProvider></body></html>;
}
