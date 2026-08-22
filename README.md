# GHManager

A dashboard for every open pull request across every GitHub repository you can
reach — with single and bulk merge, straight from the table.

![stack](https://img.shields.io/badge/Next.js-15-black) ![stack](https://img.shields.io/badge/React-19-blue) ![stack](https://img.shields.io/badge/TypeScript-5.7-blue) ![stack](https://img.shields.io/badge/Tailwind-4-38bdf8)

---

## What it does

- **Finds every open PR.** Walks all repositories you own, collaborate on, or
  reach through an organisation, and pulls their open pull requests.
- **Shows what matters.** Repository, PR title and number, author, CI/CD check
  rollup, review decision, and a plain-English mergeability verdict
  (`Ready`, `Conflicts`, `Blocked`, `Behind base`, `Draft`, `No write access`…).
- **Merges one or many.** A `Merge` button per row, checkboxes plus
  `Merge selected (n)` for bulk, with a confirmation step and per-row error
  reporting when GitHub refuses.
- **Filters and sorts.** Free-text search over title, repo, author, branch,
  labels and `#number`; filters by repository, author, readiness and drafts;
  five sort orders.
- **Keeps your token server-side.** The PAT lives in `.env.local` or an
  httpOnly cookie. Browser JavaScript never sees it, and it is only ever sent to
  github.com.

## Quick start

```bash
npm install
cp .env.example .env.local     # optional - you can paste a token in the UI instead
npm run dev                    # http://localhost:3000
```

On first load you get a token screen. Paste a GitHub personal access token and
GHManager verifies it against `GET /user` before storing it. Alternatively set
`GITHUB_TOKEN` in `.env.local` and the app starts already connected.

## Run it in Docker

```bash
docker build -t ghmanager:latest .
docker run -d --name ghmanager -p 3000:3000 ghmanager:latest
# open http://localhost:3000 and paste a token
```

Compose is the better way, because it also handles restarting. It reads
`GITHUB_TOKEN` from a `.env` file beside `docker-compose.yml` if you have one:

```bash
docker compose up -d --build
docker compose logs -f
docker compose down
```

That publishes **http://localhost** (port 80) and **http://localhost:3100**.
Port 80 means there is no port to remember or mistype; 3100 is there because 80
is easy to lose to IIS, Skype or another web server. Override either:

```bash
GHMANAGER_PORT=3000 GHMANAGER_ALT_PORT=3100 docker compose up -d
```

Note that the container logs print `Local: http://localhost:3000` on startup.
That is the port *inside* the container and it ignores your port mapping —
trust `docker ps` for the address you actually browse to.

### Starting automatically

The service sets `restart: unless-stopped`, so the Docker daemon starts
GHManager every time it starts, and restarts the container if it crashes.
`unless-stopped` rather than `always` means an explicit `docker compose stop`
stays stopped instead of coming back by itself; `docker compose up -d` re-arms
it.

That only helps once the daemon is running, so Docker Desktop has to start too.
On Windows and macOS that is **Settings → General → Start Docker Desktop when
you sign in**. Without it the container waits for you to launch Docker by hand.

Check what the container currently carries:

```bash
docker inspect ghmanager --format '{{.HostConfig.RestartPolicy.Name}}'   # unless-stopped
```

A container started with `docker run` and no `--restart` reports `no` and stays
dead after a reboot. Remove it and let Compose own it:
`docker rm -f ghmanager && docker compose up -d`.

To start already connected, pass the token instead of pasting one:

```bash
docker run -d --name ghmanager -p 3000:3000 \
  -e GITHUB_TOKEN=ghp_your_token_here ghmanager:latest
```

Point at GitHub Enterprise Server by adding
`-e GITHUB_API_BASE_URL=... -e GITHUB_GRAPHQL_URL=...`.

### About the image

Multi-stage build on `node:22-alpine` producing a ~314 MB image from Next.js
standalone output: `server.js`, only the reachable `node_modules`, and the
static assets. No source, no dev dependencies. It runs as the unprivileged
`node` user and binds `0.0.0.0` so the port publish works.

The `HEALTHCHECK` calls `/api/auth` rather than just checking the process, so
an unhealthy container is one that genuinely cannot serve requests. Watch it
with `docker ps` or `docker inspect --format '{{.State.Health.Status}}' ghmanager`.

### Cookie scheme and HTTPS

The `Secure` cookie attribute follows the request scheme, not `NODE_ENV`. A
container runs `NODE_ENV=production` but is usually reached over plain HTTP,
and a `Secure` cookie on a non-HTTPS origin is silently dropped by the browser
— sign-in would look like it worked and then immediately revert to signed out.
GHManager omits `Secure` over HTTP and sets it when the request arrives over
HTTPS, including via `x-forwarded-proto` from a TLS-terminating proxy.

Because the token cookie is `SameSite=Strict` and `HttpOnly`, put the container
behind HTTPS if you expose it beyond your own machine.

### Token scopes

| Token type    | What to grant                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Classic PAT   | `repo`                                                                                          |
| Fine-grained  | Repository permissions → **Contents: Read and write**, **Pull requests: Read and write**, **Metadata: Read-only** |

Create one at <https://github.com/settings/tokens>.

### GitHub Enterprise Server

Set both endpoints in `.env.local`:

```bash
GITHUB_API_BASE_URL=https://github.example.com/api/v3
GITHUB_GRAPHQL_URL=https://github.example.com/api/graphql
```

## Scripts

| Command             | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Development server on http://localhost:3000           |
| `npm run build`     | Production build (also type-checks route handlers)    |
| `npm start`         | Serve the production build                            |
| `npm run typecheck` | `tsc --noEmit` across app and tests                   |
| `npm test`          | Full Vitest suite, one pass                           |
| `npm run test:watch`| Vitest in watch mode                                  |
| `npm run verify`    | typecheck → test → build                              |
| `docker compose up -d --build` | Build and run the container            |

## Project structure

```
src/
├─ app/
│  ├─ layout.tsx                 Root layout + theme bootstrap
│  ├─ page.tsx                   Renders the dashboard
│  ├─ providers.tsx              TanStack Query client
│  ├─ globals.css                Design tokens (light + dark) and Tailwind entry
│  ├─ error.tsx, not-found.tsx   Route-level fallbacks
│  └─ api/
│     ├─ auth/route.ts           GET status · POST sign in · DELETE sign out
│     ├─ pulls/route.ts          GET every open PR (45s server cache)
│     └─ merge/route.ts          POST single or bulk merge
├─ components/
│  ├─ Dashboard.tsx              Orchestration: auth gate, data, selection, merge
│  ├─ TokenGate.tsx              First-run token screen
│  ├─ Header.tsx                 Identity, rate limit, refresh, theme, sign out
│  ├─ Toolbar.tsx                Search, filters, merge method, bulk action
│  ├─ PullRequestTable.tsx       Table shell + select-all
│  ├─ PullRequestRow.tsx         One PR, its badges and its merge result
│  ├─ ConfirmMergeDialog.tsx     Confirmation before anything is written
│  ├─ MergeSummary.tsx           Post-merge outcome and failure list
│  ├─ States.tsx                 Skeleton and empty states
│  └─ ui/                        Button, Checkbox, Badge, Field, Banner, Spinner
└─ lib/
   ├─ github/
   │  ├─ client.ts               REST + GraphQL client, rate-limit accounting
   │  ├─ queries.ts              GraphQL documents (incl. the aliased batch query)
   │  ├─ pulls.ts                Two-pass repository/PR fetch
   │  ├─ merge.ts                Single + bulk merge, GitHub error translation
   │  ├─ mappers.ts              Raw GraphQL → domain types, mergeability verdict
   │  ├─ errors.ts               GitHubError + status classification
   │  └─ raw.ts, config.ts       Response shapes, endpoint config
   ├─ api.ts                     Browser-side API client
   ├─ auth.ts                    Token resolution and cookie construction
   ├─ filters.ts                 Pure filter/sort/selection helpers
   ├─ hooks.ts                   useAuth, usePullRequests, useMerge, useTheme
   ├─ format.ts                  Relative time, label contrast, class joining
   ├─ concurrency.ts             Bounded parallel map, chunking
   └─ server/                    TTL cache keyed by token fingerprint
```

## How the data fetch works

Naively asking GitHub for "all open PRs across all my repos" costs one detail
query per repository, most of which have nothing open. GHManager does it in two
passes:

1. **Inventory.** Paginate `viewer.repositories` (100 at a time) selecting only
   cheap fields plus `pullRequests(states: OPEN) { totalCount }`. Archived repos
   and repos with zero open PRs are dropped here.
2. **Detail.** Batch the survivors 8 at a time into a single GraphQL document
   using aliases (`r0:`, `r1:`, …), three such documents in flight at once. Any
   repository with more open PRs than one page holds gets follow-up queries
   until it is drained.

A repository that fails is recorded as a warning and shown in the UI — one bad
repo never sinks the whole load. `rateLimit` is requested on every document, so
the header can show remaining points and what the load cost.

Results are cached server-side for 45 seconds, keyed by a SHA-256 fingerprint of
the token (never the token itself). **Refresh** sends `?refresh=1` to bypass it,
and any merge invalidates it immediately.

## How merging works

`PUT /repos/{owner}/{repo}/pulls/{number}/merge`, at most 3 concurrent, with the
head SHA attached. If the branch moved since the dashboard loaded, GitHub
refuses rather than merging something you never saw.

Every GitHub refusal is translated into an actionable sentence:

| HTTP  | Code            | What you see                                                                        |
| ----- | --------------- | ----------------------------------------------------------------------------------- |
| 405   | `NOT_MERGEABLE` | GitHub's message plus "required reviews or status checks have not passed"            |
| 409   | `HEAD_CHANGED`  | "The head branch changed after the dashboard loaded… Refresh and try again."          |
| 409   | `CONFLICT`      | The conflict message from GitHub                                                      |
| 422   | `VALIDATION`    | e.g. "Rebase merges are not allowed on this repository."                              |
| 403   | `FORBIDDEN` / `RATE_LIMITED` | Permission or rate-limit explanation                                   |
| 404   | `NOT_FOUND`     | "It may already be merged or closed, or your token may not have access."               |
| —     | `NETWORK`       | The transport error                                                                    |

A bulk merge never aborts on the first failure: every item gets a result, and
the summary panel lists each failure with a **Retry failed** button.

## Security notes

- The token is read on the server from an httpOnly, `SameSite=Strict`,
  path-scoped cookie (`Secure` in production) or from `GITHUB_TOKEN`. It is
  never placed in `localStorage` and never reaches client JavaScript.
- A cookie token takes precedence over the environment token, so you can act as
  a different identity without restarting the server. A token supplied by the
  server is marked "server token" in the UI and cannot be cleared from the
  browser.
- A cookie token that GitHub rejects is cleared automatically.
- Cache keys are `sha256(token).slice(0, 32)` — raw tokens never sit in a map.
- Bulk merges are capped at 100 items per request.

## Testing

```bash
npm test
```

233 tests across 14 files:

| Area                       | Covers                                                                       |
| -------------------------- | ---------------------------------------------------------------------------- |
| `tests/lib/client`         | Headers, rate-limit accounting, GraphQL/REST error classification, networking |
| `tests/lib/mappers`        | Check rollups, enum coercion, every mergeability branch                       |
| `tests/lib/pulls`          | Repo pagination, alias batching, per-repo PR pagination, partial failure      |
| `tests/lib/merge`          | Success, 405/409/422/403/404, bulk ordering, partial failure                  |
| `tests/lib/auth`           | Cookie parsing, precedence, cookie construction, scheme-derived `Secure`, scopes |
| `tests/lib/filters`        | Search, filters, five sorts, selection helpers                                |
| `tests/lib/utils`          | Relative time, label contrast, bounded concurrency, TTL cache                 |
| `tests/api/*`              | All three route handlers, including caching and validation                    |
| `tests/components/*`       | Table selection, toolbar, theme, and full sign-in → filter → bulk-merge flows |

The GitHub API is faked by injecting a `fetch` implementation
(`tests/mockGitHub.ts`); GHManager's own API routes are intercepted with MSW
(`tests/server.ts`). No test touches the network.

## Requirements

Node.js 20+ (developed on 24).
