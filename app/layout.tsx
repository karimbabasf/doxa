import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DOXA",
  description:
    "An industrial refinery for opinions. One opinion in, a bespoke analysis pipeline, a dithered specimen and a certificate of every operation performed.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-ground text-ink">{children}</body>
    </html>
  );
}
