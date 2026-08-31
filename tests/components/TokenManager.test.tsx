import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { TokenManager } from "@/components/TokenManager";
import type { ServerTokenSummary, ServerTokensPayload } from "@/lib/types";
import { renderWithProviders } from "~tests/renderWithProviders";
import { server } from "~tests/server";

const ORIGIN = "http://localhost:3000";

function summary(overrides: Partial<ServerTokenSummary> = {}): ServerTokenSummary {
  return {
    id: "token-1",
    label: "octocat",
    login: "octocat",
    name: "The Octocat",
    avatarUrl: null,
    url: "https://github.com/octocat",
    maskedToken: "ghp_...abcd",
    addedAt: "2026-08-30T00:00:00Z",
    active: true,
    ...overrides,
  };
}

function useTokens(payload: ServerTokensPayload): void {
  server.use(http.get(`${ORIGIN}/api/tokens`, () => HttpResponse.json(payload)));
}

beforeEach(() => {
  useTokens({ tokens: [], envTokenConfigured: false });
});

describe("TokenManager", () => {
  it("shows an empty state when nothing is stored", async () => {
    renderWithProviders(<TokenManager />);

    expect(await screen.findByTestId("tokens-empty")).toBeInTheDocument();
  });

  it("lists stored tokens with mask, label and active marker", async () => {
    useTokens({
      tokens: [
        summary(),
        summary({ id: "token-2", label: "bot", login: "hubot", active: false }),
      ],
      envTokenConfigured: false,
    });

    renderWithProviders(<TokenManager />);

    const first = await screen.findByTestId("token-row-token-1");
    expect(within(first).getByText("ghp_...abcd")).toBeInTheDocument();
    expect(within(first).getByText("Active")).toBeInTheDocument();

    const second = screen.getByTestId("token-row-token-2");
    expect(within(second).getByText("bot")).toBeInTheDocument();
    expect(
      within(second).getByRole("button", { name: "Use for dashboard" }),
    ).toBeInTheDocument();
  });

  it("warns when an environment token is also configured", async () => {
    useTokens({ tokens: [], envTokenConfigured: true });

    renderWithProviders(<TokenManager />);

    expect(
      await screen.findByText(/GITHUB_TOKEN environment variable is also set/),
    ).toBeInTheDocument();
  });

  it("adds a token and renders the server's answer", async () => {
    let posted: { token?: string; label?: string } | null = null;
    server.use(
      http.post(`${ORIGIN}/api/tokens`, async ({ request }) => {
        posted = (await request.json()) as { token: string; label?: string };
        return HttpResponse.json(
          { tokens: [summary({ label: "bot" })], envTokenConfigured: false },
          { status: 201 },
        );
      }),
    );

    const { user } = renderWithProviders(<TokenManager />);
    await screen.findByTestId("tokens-empty");

    await user.type(
      screen.getByLabelText("Personal access token"),
      "ghp_new_token_0123456789abcde",
    );
    await user.type(screen.getByLabelText("Label (optional)"), "bot");
    await user.click(screen.getByRole("button", { name: "Add token" }));

    expect(await screen.findByTestId("token-row-token-1")).toBeInTheDocument();
    expect(posted).toEqual({ token: "ghp_new_token_0123456789abcde", label: "bot" });
    expect(screen.getByLabelText("Personal access token")).toHaveValue("");
  });

  it("surfaces a rejected token as an error banner", async () => {
    server.use(
      http.post(`${ORIGIN}/api/tokens`, () =>
        HttpResponse.json({ error: "GitHub rejected that token." }, { status: 401 }),
      ),
    );

    const { user } = renderWithProviders(<TokenManager />);
    await screen.findByTestId("tokens-empty");

    await user.type(
      screen.getByLabelText("Personal access token"),
      "ghp_bad_token_0123456789abcde",
    );
    await user.click(screen.getByRole("button", { name: "Add token" }));

    expect(await screen.findByText("GitHub rejected that token.")).toBeInTheDocument();
  });

  it("refuses to submit an empty token without calling the server", async () => {
    let called = false;
    server.use(
      http.post(`${ORIGIN}/api/tokens`, () => {
        called = true;
        return HttpResponse.json({ tokens: [], envTokenConfigured: false });
      }),
    );

    const { user } = renderWithProviders(<TokenManager />);
    await screen.findByTestId("tokens-empty");

    await user.click(screen.getByRole("button", { name: "Add token" }));

    expect(
      await screen.findByText("Paste a personal access token to add it."),
    ).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("activates another token", async () => {
    useTokens({
      tokens: [
        summary(),
        summary({ id: "token-2", label: "bot", login: "hubot", active: false }),
      ],
      envTokenConfigured: false,
    });
    let patched: { id?: string; active?: boolean } | null = null;
    server.use(
      http.patch(`${ORIGIN}/api/tokens`, async ({ request }) => {
        patched = (await request.json()) as { id: string; active: boolean };
        return HttpResponse.json({
          tokens: [
            summary({ active: false }),
            summary({ id: "token-2", label: "bot", login: "hubot", active: true }),
          ],
          envTokenConfigured: false,
        });
      }),
    );

    const { user } = renderWithProviders(<TokenManager />);
    const second = await screen.findByTestId("token-row-token-2");

    await user.click(within(second).getByRole("button", { name: "Use for dashboard" }));

    await waitFor(() =>
      expect(
        within(screen.getByTestId("token-row-token-2")).getByText("Active"),
      ).toBeInTheDocument(),
    );
    expect(patched).toEqual({ id: "token-2", active: true });
  });

  it("removes a token", async () => {
    useTokens({ tokens: [summary()], envTokenConfigured: false });
    let deletedId: string | null = null;
    server.use(
      http.delete(`${ORIGIN}/api/tokens`, ({ request }) => {
        deletedId = new URL(request.url).searchParams.get("id");
        return HttpResponse.json({ tokens: [], envTokenConfigured: false });
      }),
    );

    const { user } = renderWithProviders(<TokenManager />);
    const row = await screen.findByTestId("token-row-token-1");

    await user.click(within(row).getByRole("button", { name: "Remove" }));

    expect(await screen.findByTestId("tokens-empty")).toBeInTheDocument();
    expect(deletedId).toBe("token-1");
  });
});
