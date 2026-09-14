import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Horizonbound",
  description: "Capacity-aware roadmap forecasting for Linear"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
