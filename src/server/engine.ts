import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import type { ModelChoice } from "../shared/types.js";
export { errorMessage, chatMessage } from "../shared/messages.js";

export const COPILOT_PROVIDERS = new Set(["github-copilot", "github-copilot-enterprise"]);

export function localServerUrl(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("Use an HTTP address on this computer, such as http://127.0.0.1:4096.");
  }
  // Avoid a hostname lookup for the usual localhost address.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}

export function makeClient(baseUrl: string, password: string, username = "opencode"): OpencodeClient {
  return createOpencodeClient({
    baseUrl: localServerUrl(baseUrl),
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    throwOnError: true,
    fetch: (request) => {
      // SDK requests carry their own signals, including the long-lived event stream.
      return fetch(request, { redirect: "error" });
    },
  });
}

export async function copilotModels(client: OpencodeClient, directory: string) {
  const result = await client.provider.list({ directory }, { signal: AbortSignal.timeout(15_000), throwOnError: true });
  const models: ModelChoice[] = [];
  for (const provider of result.data.all) {
    if (!COPILOT_PROVIDERS.has(provider.id) || !result.data.connected.includes(provider.id)) continue;
    for (const model of Object.values(provider.models)) {
      if (model.status === "deprecated") continue;
      models.push({ providerID: provider.id, modelID: model.id, name: model.name });
    }
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  const defaultModel = models.find((model) => result.data.default[model.providerID] === model.modelID) ?? models[0];
  return { models, defaultModel };
}
