import assert from "node:assert/strict";
import { test } from "node:test";
import { githubDeviceSignIn, GITHUB_DEVICE_METHOD, usesGithubDevice } from "../server/github-device.js";

const remote = { type: "remote", url: "https://api.githubcopilot.com/mcp/" };
const device = { verification_uri: "https://github.com/login/device", device_code: "test-only-device-secret", user_code: "ABCD-1234", interval: 5, expires_in: 900 };
const token = { access_token: "test-only-access", refresh_token: "test-only-refresh", expires_in: 3600, token_type: "bearer", scope: "read:user" };

test("GitHub device sign-in is limited to hosted endpoints without owner-supplied credentials", () => {
  assert.equal(usesGithubDevice(remote), true);
  assert.equal(usesGithubDevice({ ...remote, url: `${remote.url}x/repos/readonly` }), true);
  for (const config of [
    { ...remote, url: "https://api.githubcopilot.com.example.test/mcp/" },
    { ...remote, url: "http://api.githubcopilot.com/mcp/" },
    { ...remote, url: "https://api.githubcopilot.com:444/mcp/" },
    { ...remote, url: "https://api.githubcopilot.com/not-mcp/" },
    { ...remote, url: `${remote.url}?authorization=not-for-us` },
    { ...remote, url: "not a URL" },
    { ...remote, type: "local" },
    { ...remote, disabled: true },
    { ...remote, oauth: false as const },
    { ...remote, oauth: { client_id: "owner-supplied-app" } },
    { ...remote, oauth: { client_id: "", client_secret: "test-only-owner-secret" } },
    { ...remote, headers: { aUtHoRiZaTiOn: "owner-supplied-token" } },
  ]) assert.equal(usesGithubDevice(config), false);
});

test("GitHub device flow waits, slows polling, confirms identity and returns credentials only to OpenCode", async (t) => {
  const replies: unknown[] = [device, { error: "authorization_pending" }, { error: "slow_down" }, { error: "slow_down", interval: 20 }, token, { id: 123 }];
  const calls: { url: string; options?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    return Response.json(replies.shift());
  });
  const waits: number[] = [];
  const attempt = await githubDeviceSignIn(remote.url, undefined, new AbortController().signal, { sleep: async milliseconds => { waits.push(milliseconds); } });
  assert.equal(attempt.url, "https://github.com/login/device");
  assert.equal(attempt.instructions, "Enter code: ABCD-1234");
  assert.doesNotMatch(JSON.stringify({ url: attempt.url, instructions: attempt.instructions }), /test-only-device-secret/);
  const credential = await attempt.complete(new AbortController().signal);
  assert.deepEqual(waits, [5000, 5000, 10000, 20000]);
  assert.equal(credential.methodID, GITHUB_DEVICE_METHOD);
  assert.equal(credential.metadata.serverUrl, remote.url);
  assert.equal(credential.access, token.access_token);
  assert.equal(credential.refresh, token.refresh_token);
  assert.equal(credential.expires > Date.now(), true);
  const initial = calls[0]!.options!.body as URLSearchParams;
  assert.equal(initial.get("scope"), "read:user offline_access");
  assert.equal(initial.has("client_secret"), false);
  assert.equal(calls.at(-1)?.url, "https://api.github.com/user");
  for (const call of calls) assert.equal(call.options?.redirect, "error");
});
test("GitHub rejects an invalid slow-down interval instead of continuing the sign-in", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++requests > 2) throw new Error("Test unexpected additional sign-in request.");
    return Response.json(requests === 1 ? device : { error: "slow_down", interval: -1 });
  });
  const signal = new AbortController().signal;
  const attempt = await githubDeviceSignIn(remote.url, undefined, signal, { sleep: async () => {} });
  await assert.rejects(attempt.complete(signal), /invalid sign-in polling interval/);
  assert.equal(requests, 2);
});

test("GitHub sign-in preserves configured scopes without adding repository access", async (t) => {
  let requested = "";
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    requested = String(options.body);
    return Response.json(device);
  });
  await githubDeviceSignIn(remote.url, "repo read:org offline_access", new AbortController().signal);
  assert.equal(new URLSearchParams(requested).get("scope"), "repo read:org offline_access");
});

for (const result of [
  { ...device, verification_uri: "https://example.test/steal" },
  { ...device, user_code: "malformed code" },
  { ...device, interval: 0 },
  { error: "device_flow_disabled" },
]) {
  test(`GitHub rejects incomplete or refused device responses: ${JSON.stringify(result)}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json(result));
    await assert.rejects(githubDeviceSignIn(remote.url, undefined, new AbortController().signal), /GitHub.*(incomplete|device_flow_disabled)/);
  });
}

test("GitHub cancellation and expiry stop polling without storing credentials", async (t) => {
  let requests = 0;
  let now = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json(device); });
  const signal = new AbortController().signal;
  const expiring = await githubDeviceSignIn(remote.url, undefined, signal, { sleep: async () => { now = 900_001; } });
  await assert.rejects(expiring.complete(signal), /sign-in expired/);
  assert.equal(requests, 1);
  now = 0;
  const cancelled = new AbortController();
  const attempt = await githubDeviceSignIn(remote.url, undefined, signal, { sleep: async () => { cancelled.abort(); } });
  await assert.rejects(attempt.complete(cancelled.signal), { name: "AbortError" });
  assert.equal(requests, 2);
});

for (const result of [{ error: "access_denied" }, { ...token, refresh_token: "" }, { ...token, token_type: "unexpected" }]) {
  test(`GitHub rejects refused or incomplete tokens: ${JSON.stringify(result)}`, async (t) => {
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => Response.json(++requests === 1 ? device : result));
    const signal = new AbortController().signal;
    const attempt = await githubDeviceSignIn(remote.url, undefined, signal, { sleep: async () => {} });
    await assert.rejects(attempt.complete(signal), /GitHub.*(access_denied|expiring sign-in token)/);
    assert.equal(requests, 2, "No account call or credential may follow a rejected token");
  });
}

test("GitHub account lookup failures stay real errors instead of successful credentials", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => ++requests === 1 ? Response.json(device) : requests === 2 ? Response.json(token) : new Response("", { status: 403 }));
  const signal = new AbortController().signal;
  const attempt = await githubDeviceSignIn(remote.url, undefined, signal, { sleep: async () => {} });
  await assert.rejects(attempt.complete(signal), /confirm the signed-in account \(HTTP 403\)/);
});
