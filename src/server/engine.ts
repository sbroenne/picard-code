import { OpenCode } from "./opencode.js";
import type { ModelChoice } from "../shared/types.js";
export { errorMessage } from "../shared/messages.js";
export { chatMessages } from "./history.js";

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

export function makeClient(baseUrl: string, password: string, username = "opencode") {
  return new OpenCode(localServerUrl(baseUrl), password, username);
}

/** Picard Code speaks OpenCode 2's interface; older servers answer differently. */
export async function checkVersion(client: OpenCode) {
  const { version } = await client.info();
  if (!/^2\./.test(version)) throw new Error(`Picard Code needs OpenCode 2, but this OpenCode is version ${version}. Update it from https://opencode.ai, or set PICARD_OPENCODE_PATH to an OpenCode 2 program.`);
  return version;
}

/** Every model OpenCode can use right now, from any provider. OpenCode lists only providers it can reach. */
export async function availableModels(client: OpenCode, directory: string) {
  const [all, preferred, providers] = await Promise.all([
    client.models(directory),
    client.defaultModel(directory).catch(() => null),
    client.providers(directory).catch(() => []),
  ]);
  // Only provider names are kept: OpenCode's provider settings can hold keys.
  const providerName = new Map(providers.map((provider) => [provider.id, provider.name]));
  const models: ModelChoice[] = all
    .filter((model) => model.enabled !== false && model.status !== "deprecated")
    .map((model) => ({ providerID: model.providerID, provider: providerName.get(model.providerID) ?? model.providerID, modelID: model.id, name: model.name }));
  models.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  const defaultModel = models.find((model) => model.providerID === preferred?.providerID && model.modelID === preferred.id) ?? models[0];
  return { models, defaultModel };
}
