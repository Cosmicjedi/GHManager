import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";
import { renderWithProviders } from "~tests/renderWithProviders";

describe("ThemeToggle", () => {
  it("starts on the system theme with no data-theme attribute", () => {
    renderWithProviders(<ThemeToggle />);

    expect(screen.getByRole("button", { name: /Theme: follow system/ })).toBeInTheDocument();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("cycles system, light, dark and back, persisting the choice", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Theme: follow system/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem("ghmanager-theme")).toBe("light");

    await user.click(screen.getByRole("button", { name: /Theme: light/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("ghmanager-theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: /Theme: dark/ }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem("ghmanager-theme")).toBeNull();
  });

  it("restores a stored theme on mount", async () => {
    window.localStorage.setItem("ghmanager-theme", "dark");
    renderWithProviders(<ThemeToggle />);

    expect(await screen.findByRole("button", { name: /Theme: dark/ })).toBeInTheDocument();
  });
});
