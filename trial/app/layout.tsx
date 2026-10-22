import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";
import { publicConfig } from "@/lib/server/config";
import { getRequestMessages } from "@/lib/i18n/server";

// latin-ext carries the Turkish letters (ğ, ş, ı, İ).
const display = Inter_Tight({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter-tight",
  display: "swap",
  weight: ["500"],
});
const body = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500"],
});
const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["400", "500"],
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const { messages } = await getRequestMessages();
  return {
    title: messages.meta.title,
    description: messages.meta.description,
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#0B0B0C",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, messages } = await getRequestMessages();
  return (
    <html lang={locale} className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="grain">
        <AppProviders locale={locale} messages={messages} config={publicConfig()}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
