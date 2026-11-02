import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import WebSocket from "ws";
import { startFixture } from "../dist/tests/fixture.js";
import { speechFixture } from "../dist/tests/speech-fixture.js";
import { makeClient } from "../dist/server/engine.js";
import { startApp } from "../dist/server/app.js";
import { startDevelopmentServer } from "./dev-server.mjs";

test("development rejects nonlocal backend addresses", async () => {
  for (const address of ["https://example.com", "http://localhost:3000", "http://127.0.0.1/api/", "http://name:secret@127.0.0.1"]) {
    await assert.rejects(startDevelopmentServer(address), /local HTTP address/);
  }
});

test("Vite updates styles and keeps the real app's local connection checks", { timeout: 60000 }, async (t) => {
  const project = await mkdtemp(join(tmpdir(), "picard-dev-check-"));
  t.after(() => rm(project, { recursive: true }));
  const fixture = await startFixture(project);
  t.after(() => fixture.close());
  const app = await startApp({
    client: makeClient(fixture.url, fixture.password), project, webRoot: resolve("web-dist"),
    speechFile: join(project, "speech.json"), speech: speechFixture([""]).service,
  });
  t.after(() => app.close());
  const dev = await startDevelopmentServer(app.origin);
  t.after(() => dev.close());
  const post = (body, extra = {}) => fetch(`${dev.origin}/api/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Picard-Request": "1", Origin: dev.origin, ...extra },
    body: JSON.stringify(body),
  });
  assert.equal((await fetch(`${dev.origin}/api/state`)).status, 401);
  assert.equal((await post({ token: "wrong" })).status, 401);
  assert.equal((await post({ token: app.token }, { Origin: "https://example.com" })).status, 403);
  assert.equal((await post({ token: app.token }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await post({ token: app.token }, { "X-Picard-Request": "0" })).status, 403);
  const wrongHost = await new Promise((done, fail) => {
    const req = request(dev.origin, { headers: { Host: "example.com" } }, (response) => {
      response.resume();
      done(response.statusCode);
    });
    req.once("error", fail);
    req.end();
  });
  assert.equal(wrongHost, 403);
  const connected = await post({ token: app.token });
  assert.equal(connected.status, 200);
  const cookie = connected.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(`${dev.origin}/api/state`, { headers: { Cookie: cookie } })).status, 200);
  const socket = new WebSocket(`${dev.origin.replace("http:", "ws:")}/api/speech`, {
    headers: { Cookie: cookie, Origin: dev.origin },
  });
  await once(socket, "open");
  socket.close();
  await once(socket, "close");
  for (const headers of [{ Origin: "https://example.com", Cookie: cookie }, { Origin: dev.origin }]) {
    const denied = new WebSocket(`${dev.origin.replace("http:", "ws:")}/api/speech`, { headers });
    denied.on("error", (error) => { assert.match(error.message, /closed before the connection was established/); });
    const [, response] = await once(denied, "unexpected-response");
    assert.equal(response.statusCode, 403);
    response.resume();
    denied.terminate();
  }
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${dev.origin}/#token=${app.token}`);
  await expect(page.locator("#status")).toHaveText(/Standing by|Microphone off|Starting microphone/);
  const cssName = `.picard-dev-check-${process.pid}.css`;
  const cssPath = resolve("web", cssName);
  t.after(() => rm(cssPath, { force: true }));
  await writeFile(cssPath, "body { --picard-dev-check: first; }");
  await page.evaluate((path) => import(path), `/${cssName}`);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--picard-dev-check").trim())).toBe("first");
  await page.evaluate(() => { window.picardDevelopmentCheck = true; });
  await writeFile(cssPath, "body { --picard-dev-check: second; }");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--picard-dev-check").trim())).toBe("second");
  assert.equal(await page.evaluate(() => window.picardDevelopmentCheck), true, "style changes must not reload the page");
});
