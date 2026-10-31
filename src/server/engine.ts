import { OpenCode } from "./opencode.js";
import type { ModelChoice } from "../shared/types.js";
export { errorMessage } from "../shared/messages.js";
export { chatMessages } from "./history.js";

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

export function makeClient(baseUrl: string, password: string, username = "opencode") {
  return new OpenCode(localServerUrl(baseUrl), password, username);
}

/** Picard Code speaks OpenCode 2's interface; older servers answer differently. */
export async function checkVersion(client: OpenCode) {
  const { version } = await client.info();
  if (!/^2\./.test(version)) throw new Error(`Picard Code needs OpenCode 2, but this OpenCode is version ${version}. Run npm install in the Picard Code folder, or update OpenCode.`);
  return version;
}

/** GitHub Copilot models OpenCode can use. OpenCode lists only providers that are signed in. */
export async function copilotModels(client: OpenCode, directory: string) {
  const [all, preferred] = await Promise.all([
    client.models(directory),
    client.defaultModel(directory).catch(() => null),
  ]);
  const models: ModelChoice[] = all
    .filter((model) => COPILOT_PROVIDERS.has(model.providerID) && model.enabled !== false && model.status !== "deprecated")
    .map((model) => ({ providerID: model.providerID, modelID: model.id, name: model.name }));
  models.sort((a, b) => a.name.localeCompare(b.name));
  const defaultModel = models.find((model) => model.providerID === preferred?.providerID && model.modelID === preferred.id) ?? models[0];
  return { models, defaultModel };
}
