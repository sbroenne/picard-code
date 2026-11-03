import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ModelSelection } from "../shared/types.js";
import { errorMessage } from "../shared/messages.js";

export const modelSettingsFile = join(homedir(), ".picard-code", "model.json");

export function modelSelection(value: unknown): ModelSelection {
  if (!value || typeof value !== "object") throw new Error("Choose a provider and model.");
  const { providerID, modelID } = value as Record<string, unknown>;
  const valid = (id: unknown): id is string => typeof id === "string" && id.trim() === id && id.length > 0 && id.length <= 256;
  if (!valid(providerID) || !valid(modelID)) {
    throw new Error("Choose a valid provider and model.");
  }
  return { providerID, modelID };
}

export async function readModelSettings(file = modelSettingsFile): Promise<ModelSelection | undefined> {
  let text: string;
  try { text = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Could not read the saved model choice. ${errorMessage(error)}`);
  }
  try { return modelSelection(JSON.parse(text)); }
  catch { throw new Error("The saved model choice is not valid. Open Computer intelligence and confirm a model to replace it."); }
}

export async function saveModelSettings(file: string, value: ModelSelection) {
  const choice = modelSelection(value);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(choice, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  } catch (error) {
    throw new Error(`Could not save the model choice. ${errorMessage(error)}`);
  }
}
