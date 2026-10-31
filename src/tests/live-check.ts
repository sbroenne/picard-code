import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { startEngine, projectDirectory } from "../server/process.js";
import { copilotModels } from "../server/engine.js";

const temporary = await mkdtemp(resolve(".picard-live-check-"));
const project = await projectDirectory(temporary);
let engine: Awaited<ReturnType<typeof startEngine>> | undefined;
let sessionID: string | undefined;
const controller = new AbortController();
try {
  engine = await startEngine(project);
  const { client } = engine;
  const info = await client.info();
  assert.match(info.version, /^2\./);
  const location = await client.location(project);
  assert.equal(location.directory, project);
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const first = await client.events(controller.signal).next();
    assert.equal(first.value?.type, "server.connected");
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  const session = await client.createSession(project, "Picard Code connection check");
  sessionID = session.id;
  assert.deepEqual(await client.messages(sessionID, project), []);
  await client.permissions(project);
  await client.forms(project);
  const models = await copilotModels(client, project);
  console.log(`Real OpenCode ${info.version}: startup, project context, saved conversation, event stream, and approval/question endpoints passed.`);
  console.log(models.models.length
    ? `OpenCode reports ${models.models.length} connected Copilot models. No paid model request was made.`
    : "GitHub Copilot is not connected in OpenCode. A real model reply still needs the user's official device sign-in.");
} finally {
  controller.abort();
  try {
    if (engine && sessionID) await engine.client.deleteSession(sessionID, project);
  } finally {
    await engine?.close();
    await rm(temporary, { recursive: true });
    if (engine?.child.pid) {
      assert.ok(engine.child.exitCode !== null || engine.child.signalCode !== null, "The owned OpenCode process must stop.");
    }
  }
}
