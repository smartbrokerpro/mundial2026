import type { Metadata } from "next";
import "./globals.css";
import BackgroundFX from "@/components/BackgroundFX";

export const metadata: Metadata = {
  title: "Mundial 2026 · Llaves en vivo",
  description:
    "Calendario, resultados en vivo y llaves del Mundial 2026 — Next.js + MongoDB",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <BackgroundFX />
        {children}
      </body>
    </html>
  );
}
