"use client";

import { Button } from "@/components/ui/Button";
import { type Theme, useTheme } from "@/lib/hooks";

const NEXT: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const LABEL: Record<Theme, string> = {
  system: "Theme: follow system",
  light: "Theme: light",
  dark: "Theme: dark",
};

const GLYPH: Record<Theme, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(NEXT[theme])}
      title={`${LABEL[theme]} (click to change)`}
      aria-label={`${LABEL[theme]}. Activate to switch to ${NEXT[theme]}.`}
      className="w-8 px-0 text-base"
    >
      <span aria-hidden>{GLYPH[theme]}</span>
    </Button>
  );
}
