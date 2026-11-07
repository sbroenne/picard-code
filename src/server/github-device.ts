import { setTimeout as delay } from "node:timers/promises";

export const GITHUB_DEVICE_METHOD = "picard-github-device";
const clientID = "Ov23lig75OIWhFk2OEXK";

export interface GithubMcpConfig {
  type: string;
  url?: string;
  disabled?: boolean;
  headers?: Record<string, string>;
  oauth?: false | { client_id?: string; client_secret?: string; scope?: string };
}

/** Explicit credentials keep their own sign-in; only GitHub's hosted service uses our public app. */
export function usesGithubDevice(config: GithubMcpConfig): boolean {
  if (config.type !== "remote" || !config.url || config.disabled || config.oauth === false || config.oauth?.client_id || config.oauth?.client_secret
    || Object.keys(config.headers ?? {}).some((name) => name.toLowerCase() === "authorization")) return false;
  try {
    const url = new URL(config.url);
    return url.origin === "https://api.githubcopilot.com" && !url.username && !url.password
      && !url.search && !url.hash && (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/"));
  } catch { return false; }
}

interface GithubCredential {
  type: "oauth";
  methodID: string;
  access: string;
  refresh: string;
  expires: number;
  metadata: { serverUrl: string; tokenType: string; scope: string; client: { client_id: string } };
}

export async function githubDeviceSignIn(serverUrl: string, scope: string | undefined, signal: AbortSignal, options: {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
} = {}) {
  const fetcher = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
  async function request(url: string, fields: Record<string, string>, signal: AbortSignal) {
    const response = await fetcher(url, {
      method: "POST", redirect: "error", signal,
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Picard-Code" },
      body: new URLSearchParams(fields),
    });
    if (!response.ok) throw new Error(`GitHub sign-in answered with HTTP ${response.status}.`);
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GitHub returned an invalid sign-in response.");
    const result = value as Record<string, unknown>;
    if (result.error !== undefined) {
      if (typeof result.error !== "string" || !/^[a-z_]+$/.test(result.error)) throw new Error("GitHub returned an invalid sign-in error.");
      if (!["authorization_pending", "slow_down"].includes(result.error)) throw new Error(`GitHub sign-in failed: ${result.error}`);
    }
    return result;
  }
  const scopes = [...new Set([...(scope?.trim() || "read:user").split(/\s+/), "offline_access"])].join(" ");
  const device = await request("https://github.com/login/device/code", { client_id: clientID, scope: scopes }, signal);
  if (device.verification_uri !== "https://github.com/login/device"
    || typeof device.device_code !== "string" || !device.device_code
    || typeof device.user_code !== "string" || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(device.user_code)
    || typeof device.interval !== "number" || !Number.isInteger(device.interval) || device.interval < 1
    || typeof device.expires_in !== "number" || !Number.isInteger(device.expires_in) || device.expires_in < 1) {
    throw new Error("GitHub returned an incomplete device sign-in response.");
  }
  const deviceCode = device.device_code;
  const expiresAt = Date.now() + device.expires_in * 1000;
  let interval = device.interval * 1000;
  return {
    url: device.verification_uri,
    instructions: `Enter code: ${device.user_code}`,
    expiresAt,
    async complete(signal: AbortSignal): Promise<GithubCredential> {
      while (Date.now() < expiresAt) {
        await sleep(interval, signal);
        signal.throwIfAborted();
        if (Date.now() >= expiresAt) break;
        const token = await request("https://github.com/login/oauth/access_token", {
          client_id: clientID, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }, signal);
        if (token.error === "authorization_pending") continue;
        if (token.error === "slow_down") {
          if (token.interval !== undefined && (typeof token.interval !== "number" || !Number.isInteger(token.interval) || token.interval <= 0)) {
            throw new Error("GitHub returned an invalid sign-in polling interval.");
          }
          interval = Math.max(interval + 5000, typeof token.interval === "number" ? token.interval * 1000 : 0);
          continue;
        }
        if (typeof token.access_token !== "string" || !token.access_token
          || typeof token.refresh_token !== "string" || !token.refresh_token
          || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0
          || typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "bearer"
          || typeof token.scope !== "string") throw new Error("GitHub did not return the requested expiring sign-in token.");
        const response = await fetcher("https://api.github.com/user", {
          redirect: "error", signal,
          headers: { Accept: "application/json", Authorization: `Bearer ${token.access_token}`, "User-Agent": "Picard-Code" },
        });
        if (!response.ok) throw new Error(`GitHub could not confirm the signed-in account (HTTP ${response.status}).`);
        const user: unknown = await response.json();
        if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "number") throw new Error("GitHub returned no signed-in account.");
        return {
          type: "oauth", methodID: GITHUB_DEVICE_METHOD, access: token.access_token, refresh: token.refresh_token,
          expires: Date.now() + token.expires_in * 1000,
          metadata: { serverUrl, tokenType: token.token_type, scope: token.scope, client: { client_id: clientID } },
        };
      }
      throw new Error("GitHub sign-in expired. Choose Sign in to try again.");
    },
  };
}
