import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insurix",
  description: "Know what your hospital bill actually pays out, and why.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
