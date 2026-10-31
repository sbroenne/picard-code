import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { startEngine, projectDirectory } from "../server/process.js";
import { availableModels } from "../server/engine.js";
import { BRIDGE_CREW } from "../shared/crew.js";
import { verifiedCrew } from "../server/crew.js";

const temporary = await mkdtemp(resolve(".picard-live-check-"));
const project = await projectDirectory(temporary);
let engine: Awaited<ReturnType<typeof startEngine>> | undefined;
let sessionID: string | undefined;
const controller = new AbortController();
try {
  await writeFile(resolve(project, "opencode.json"), JSON.stringify({
    agents: { build: { permissions: [{ action: "shell", resource: "*", effect: "ask" }, { action: "edit", resource: "*", effect: "deny" }] } },
  }));
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
  assert.equal(verifiedCrew(await client.agents(project)), true);
  for (const officer of BRIDGE_CREW) {
    await client.setAgent(sessionID, project, officer.id);
    assert.equal((await client.session(sessionID, project)).agent, officer.id);
  }
  const child = await client.createSession(project, "Crew child check", undefined, { agent: "picard-data", parentID: sessionID });
  assert.equal(child.parentID, sessionID);
  assert.equal(child.agent, "picard-data");
  assert.ok((await client.sessions(project, sessionID)).some((entry) => entry.id === child.id));
  await client.interrupt(child.id, project);
  await client.deleteSession(child.id, project);
  assert.deepEqual(await readdir(project), ["opencode.json"], "crew setup must not write into the project");
  const other = resolve(project, "other");
  await mkdir(other);
  await writeFile(resolve(other, "opencode.json"), JSON.stringify({ agents: { build: { permissions: [{ action: "shell", resource: "*", effect: "deny" }] } } }));
  await client.location(other);
  await engine.prepareCrew(other);
  assert.equal(verifiedCrew(await client.agents(other)), true, "the new project's coding rules apply to every officer");
  await engine.prepareCrew(project);
  const models = await availableModels(client, project);
  console.log(`Real OpenCode ${info.version}: startup, project context, saved conversation, event stream, and approval/question endpoints passed.`);
  console.log("All six crew agents, selection, child ownership, project-specific permission inheritance and setup without project files passed.");
  console.log(models.models.length
    ? `OpenCode reports ${models.models.length} models from ${[...new Set(models.models.map((model) => model.provider))].join(", ")}. No paid model request was made.`
    : "No model provider is signed in to OpenCode. A real model reply still needs a sign-in.");
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
