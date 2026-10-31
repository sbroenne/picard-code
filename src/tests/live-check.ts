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
  const health = await client.global.health({ throwOnError: true, signal: AbortSignal.timeout(5000) });
  assert.equal(health.data.healthy, true);
  const path = await client.path.get({ directory: project }, { throwOnError: true });
  assert.equal(path.data.directory, project);
  const subscription = await client.event.subscribe({ directory: project }, { signal: controller.signal, sseMaxRetryAttempts: 0 });
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const first = await subscription.stream.next();
    assert.equal(first.value?.type, "server.connected");
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  const session = await client.session.create({ directory: project, title: "Picard Code connection check" }, { throwOnError: true });
  sessionID = session.data.id;
  const messages = await client.session.messages({ directory: project, sessionID }, { throwOnError: true });
  assert.deepEqual(messages.data, []);
  await client.permission.list({ directory: project }, { throwOnError: true });
  await client.question.list({ directory: project }, { throwOnError: true });
  const models = await copilotModels(client, project);
  console.log(`Real OpenCode ${health.data.version}: startup, project context, saved conversation, event stream, and approval/question endpoints passed.`);
  console.log(models.models.length
    ? `OpenCode reports ${models.models.length} connected Copilot models. No paid model request was made.`
    : "GitHub Copilot is not connected in OpenCode. A real model reply still needs the user's official device sign-in.");
} finally {
  controller.abort();
  try {
    if (engine && sessionID) await engine.client.session.delete({ directory: project, sessionID }, { throwOnError: true });
  } finally {
    await engine?.close();
    await rm(temporary, { recursive: true });
    if (engine?.child.pid) {
      assert.ok(engine.child.exitCode !== null || engine.child.signalCode !== null, "The owned OpenCode process must stop.");
    }
  }
}
