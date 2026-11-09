// Minimal Upstash Redis REST client (server only). Uses plain fetch, so no extra package.
// Credentials come from the Vercel ↔ Upstash integration and never reach the browser.

export type RedisAccess = "read" | "write";
export type RedisCommand = (string | number)[];

export class RedisUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RedisUnavailableError";
  }
}

function credentials(access: RedisAccess) {
  const url = process.env.KV_REST_API_URL?.trim().replace(/\/+$/, "");
  // Reads use the read-only token, so read-only APIs cannot modify data even if misused.
  const token = (access === "read" ? process.env.KV_REST_API_READ_ONLY_TOKEN : process.env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token || !/^https:\/\//.test(url)) return null;
  return { url, token };
}

export function isRedisConfigured(access: RedisAccess = "write") {
  return credentials(access) !== null;
}

/**
 * Runs several commands in one HTTP round trip. Throws RedisUnavailableError on missing
 * configuration, network failure, timeout, or any command error. Never logs credentials.
 */
export async function redisPipeline(commands: RedisCommand[], access: RedisAccess, timeoutMs = 2500): Promise<unknown[]> {
  if (commands.length === 0) return [];
  const config = credentials(access);
  if (!config) throw new RedisUnavailableError("NOT_CONFIGURED");

  let response: Response;
  try {
    response = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands.map((command) => command.map(String))),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new RedisUnavailableError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_FAILURE");
  }

  if (!response.ok) throw new RedisUnavailableError(`HTTP_${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RedisUnavailableError("NON_JSON_RESPONSE");
  }
  if (!Array.isArray(body) || body.length !== commands.length) throw new RedisUnavailableError("BAD_RESPONSE");

  return body.map((entry: { result?: unknown; error?: string }, index) => {
    if (entry?.error) throw new RedisUnavailableError(`COMMAND_ERROR:${String(commands[index][0])}`);
    return entry?.result ?? null;
  });
}

/** Separates production, preview deployments, and local development data in the same database. */
export function keyPrefix() {
  const env = process.env.VERCEL_ENV === "production" ? "prod" : process.env.VERCEL_ENV === "preview" ? "preview" : "dev";
  return `bm:${env}:v1:`;
}
