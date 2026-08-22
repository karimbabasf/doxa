import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DOXA",
  description:
    "An industrial refinery for opinions. One opinion in, a bespoke analysis pipeline, a dithered specimen and a certificate of every operation performed.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // `dark` is what switches both component kits into their dark styles. They are
  // written with `dark:` variants throughout and shadcn's init set that variant to
  // `.dark *`, so without the class every imported component renders its light skin:
  // stone-700 text on a near black ground, which is almost unreadable. The class also
  // selects the token bridge in globals.css, so one word here is what makes ninety
  // three imported files wear the DOXA palette.
  return (
    <html lang="en" className="dark h-full">
      <body className="min-h-full flex flex-col bg-ground text-ink">{children}</body>
    </html>
  );
}
