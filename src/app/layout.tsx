import type { Metadata, Viewport } from "next";
import { Providers } from "@/app/providers";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "GHManager - open pull requests",
  description:
    "Review and merge every open pull request across all of your GitHub repositories from one dashboard.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f15" },
  ],
};

/**
 * Applied before paint so a user who picked a theme never sees the other one
 * flash first.
 */
const THEME_BOOTSTRAP = `
(function () {
  try {
    var stored = window.localStorage.getItem("ghmanager-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (error) {
    /* localStorage can throw in private mode; the media query default is fine. */
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-full antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
