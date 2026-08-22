import type { MergeErrorCode } from "@/lib/types";

/** Error thrown for any non-2xx GitHub response or GraphQL `errors` payload. */
export class GitHubError extends Error {
  readonly status: number;
  readonly code: MergeErrorCode;
  readonly documentationUrl: string | null;
  readonly details: string[];

  constructor(
    message: string,
    options: {
      status?: number;
      code?: MergeErrorCode;
      documentationUrl?: string | null;
      details?: string[];
    } = {},
  ) {
    super(message);
    this.name = "GitHubError";
    this.status = options.status ?? 0;
    this.code = options.code ?? classifyStatus(this.status);
    this.documentationUrl = options.documentationUrl ?? null;
    this.details = options.details ?? [];
  }
}

/** Map a raw HTTP status onto the error taxonomy the UI understands. */
export function classifyStatus(status: number): MergeErrorCode {
  switch (status) {
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 409:
      return "CONFLICT";
    case 422:
      return "VALIDATION";
    case 429:
      return "RATE_LIMITED";
    default:
      return status === 0 ? "NETWORK" : "UNKNOWN";
  }
}

/**
 * Pull the most useful message out of a GitHub error body, which comes in a
 * few different shapes depending on which part of the API answered.
 */
export function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (!body || typeof body !== "object") return fallback;

  const record = body as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof record.message === "string" && record.message.trim()) {
    parts.push(record.message.trim());
  }

  if (Array.isArray(record.errors)) {
    for (const entry of record.errors) {
      if (typeof entry === "string") {
        parts.push(entry);
      } else if (entry && typeof entry === "object") {
        const detail = entry as Record<string, unknown>;
        const text =
          (typeof detail.message === "string" && detail.message) ||
          (typeof detail.code === "string" && `${detail.field ?? "field"}: ${detail.code}`) ||
          null;
        if (text) parts.push(String(text));
      }
    }
  }

  const unique = [...new Set(parts.filter(Boolean))];
  return unique.length ? unique.join(" - ") : fallback;
}

/** Collect the `errors[].message` list from a GitHub error body. */
export function extractErrorDetails(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const errors = (body as Record<string, unknown>).errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const detail = entry as Record<string, unknown>;
        if (typeof detail.message === "string") return detail.message;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
}
