import assert from "node:assert/strict";
import test from "node:test";
import { wikipediaReader } from "../server/wikipedia.js";

const article = (title = "Jean-Luc Picard", extract = "Original test stand-in for an article.") => ({
  query: { pages: [{ title, extract }] },
});

test("Wikipedia requests use only the two fixed articles and never send the user's question", async () => {
  const requests: URL[] = [];
  const read = wikipediaReader(async (input, options) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(url.origin, "https://en.wikipedia.org");
    assert.equal(url.pathname, "/w/api.php");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    const title = url.searchParams.get("titles")!;
    return Response.json(article(title));
  });
  for (const subject of ["Picard", "Patrick Stewart"] as const) {
    const result = await read(subject);
    assert.equal(result.subject, subject);
    assert.equal(result.url, subject === "Picard" ? "https://en.wikipedia.org/wiki/Jean-Luc_Picard" : "https://en.wikipedia.org/wiki/Patrick_Stewart");
    assert.equal(result.text, "Original test stand-in for an article.");
  }
  assert.deepEqual(requests.map((url) => url.searchParams.get("titles")), ["Jean-Luc Picard", "Patrick Stewart"]);
  assert.ok(requests.every((url) => !url.searchParams.has("search")));
});

test("Wikipedia caches successful articles for ten minutes, but does not cache failures", async () => {
  let time = 0;
  let calls = 0;
  const read = wikipediaReader(async () => { calls++; return Response.json(article()); }, () => time);
  const first = await read("Picard");
  time = 599_999;
  assert.equal(await read("Picard"), first);
  assert.equal(calls, 1);
  time = 600_000;
  await read("Picard");
  assert.equal(calls, 2);
  let retries = 0;
  const retry = wikipediaReader(async () => ++retries === 1 ? new Response("Unavailable", { status: 503 }) : Response.json(article()));
  await assert.rejects(retry("Picard"), /Could not read Wikipedia.*HTTP 503/);
  assert.equal((await retry("Picard")).subject, "Picard");
  assert.equal(retries, 2);
});

test("Wikipedia rejects missing, wrong, malformed and oversized articles with real errors", async () => {
  for (const response of [
    new Response("Redirect", { status: 302 }),
    new Response("not JSON"),
    Response.json({ query: { pages: [] } }),
    Response.json(article("Another article")),
    Response.json(article("Jean-Luc Picard", "")),
    Response.json({ query: { pages: [{ title: "Jean-Luc Picard", missing: true, extract: "not real" }] } }),
    Response.json(article("Jean-Luc Picard", "x".repeat(80_001))),
    new Response("x".repeat(1_000_001)),
  ]) {
    await assert.rejects(wikipediaReader(async () => response)("Picard"), /Could not read Wikipedia/);
  }
  await assert.rejects(wikipediaReader(async () => { throw new Error("Connection timed out."); })("Picard"), /Connection timed out/);
});
