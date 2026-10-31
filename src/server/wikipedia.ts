import type { TributeEntry } from "../shared/tribute-data.js";
import { errorMessage } from "../shared/messages.js";

export interface WikipediaArticle {
  subject: TributeEntry["subject"];
  title: string;
  url: string;
  text: string;
}

const TITLES = { Picard: "Jean-Luc Picard", "Patrick Stewart": "Patrick Stewart" } as const;
const MAX_BYTES = 1_000_000;
const MAX_TEXT = 80_000;
const CACHE_TIME = 10 * 60_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function wikipediaReader(fetcher: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<TributeEntry["subject"], { article: WikipediaArticle; expires: number }>();
  return async (subject: TributeEntry["subject"]): Promise<WikipediaArticle> => {
    if (subject !== "Picard" && subject !== "Patrick Stewart") throw new Error("That Wikipedia subject is not supported.");
    const title = TITLES[subject];
    const saved = cache.get(subject);
    if (saved && saved.expires > now()) return saved.article;
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query", prop: "extracts", explaintext: "1", format: "json", formatversion: "2", titles: title,
    }).toString();
    try {
      const response = await fetcher(url, {
        redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json", "User-Agent": "PicardCode/0.1.0 (local tribute app)" },
      });
      if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}.`);
      if (!response.body) throw new Error("Wikipedia returned no article.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_BYTES) throw new Error("Wikipedia returned an article that is too large.");
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
      }
      const data = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const query = record(data?.query);
      const pages = query?.pages;
      const page = Array.isArray(pages) && pages.length === 1 ? record(pages[0]) : undefined;
      if (!page || page.title !== title || "missing" in page || typeof page.extract !== "string" || !page.extract.trim()) {
        throw new Error("Wikipedia did not return the requested article text.");
      }
      if (page.extract.length > MAX_TEXT) throw new Error("Wikipedia returned an article that is too long.");
      const article: WikipediaArticle = {
        subject, title: `Wikipedia: ${title}`,
        url: `https://en.wikipedia.org/wiki/${title.replaceAll(" ", "_")}`,
        text: page.extract.trim(),
      };
      cache.set(subject, { article, expires: now() + CACHE_TIME });
      return article;
    } catch (error) {
      throw new Error(`Could not read Wikipedia. ${errorMessage(error)}`);
    }
  };
}
