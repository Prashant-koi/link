import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudentOS",
  description: "A university as a connected graph — perspectival by role, navigable by an AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
