import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadVerified } from "./setup-nemotron.mjs";

export const TURN_MODEL = "smart-turn-v3.2-cpu.onnx";
export const TURN_MODEL_SHA256 = "2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f";
const REVISION = "f766f81d3cfdf7737ac64aad813d91bbfd56bf93";

export async function setupTurn(home, signal) {
  const folder = join(home, "voice", "models");
  await mkdir(folder, { recursive: true });
  const model = join(folder, TURN_MODEL);
  await downloadVerified(`https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/${REVISION}/${TURN_MODEL}`, model, TURN_MODEL_SHA256, signal);
  signal?.throwIfAborted();
  await copyFile(fileURLToPath(new URL("./smart-turn-LICENSE.txt", import.meta.url)), join(folder, "smart-turn-LICENSE.txt"));
  return model;
}
