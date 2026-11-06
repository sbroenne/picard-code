import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startEngine, projectDirectory, openCodeCommand, freePort } from "../server/process.js";
import { availableModels } from "../server/engine.js";
import { BRIDGE_CREW } from "../shared/crew.js";
import { verifiedCrew } from "../server/crew.js";

const temporary = await mkdtemp(resolve(".picard-live-check-"));
const settings = await mkdtemp(join(tmpdir(), "picard-opencode-settings-"));
const savedEnvironment = Object.fromEntries(
  ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT", "OPENCODE_PASSWORD"]
    .map((key) => [key, process.env[key]]),
);
const project = await projectDirectory(temporary);
let engine: Awaited<ReturnType<typeof startEngine>> | undefined;
let sessionID: string | undefined;
const controller = new AbortController();
try {
  process.env.XDG_CONFIG_HOME = join(settings, "config");
  process.env.XDG_DATA_HOME = join(settings, "data");
  process.env.XDG_STATE_HOME = join(settings, "state");
  delete process.env.OPENCODE_CONFIG;
  delete process.env.OPENCODE_CONFIG_DIR;
  delete process.env.OPENCODE_CONFIG_CONTENT;
  delete process.env.OPENCODE_PASSWORD;
  const globalSettings = join(process.env.XDG_CONFIG_HOME, "opencode");
  await mkdir(globalSettings, { recursive: true });
  const globalConfig = JSON.stringify({
    mcp: { servers: { "picard-global-check": { type: "remote", url: "http://127.0.0.1:1/mcp", disabled: true } } },
  });
  await writeFile(join(globalSettings, "opencode.json"), globalConfig);
  await writeFile(resolve(project, "opencode.json"), JSON.stringify({
    agents: { build: { permissions: [{ action: "shell", resource: "*", effect: "ask" }, { action: "edit", resource: "*", effect: "deny" }] } },
  }));
  engine = await startEngine(project);
  assert.equal(engine.crewProblem, undefined, "the crew loads with Picard Code's own OpenCode server");
  const { client } = engine;
  const info = await client.info();
  assert.match(info.version, /^2\./);
  const servers = await client.mcpServers(project);
  assert.deepEqual(servers.map(({ name, status }) => ({ name, status: status.status })), [
    { name: "picard-global-check", status: "disabled" },
  ], "Picard Code must preserve globally configured MCP servers while loading the crew");
  const command = await openCodeCommand();
  const runOpenCode = (args: string[]) => promisify(execFile)(command.command, [...command.prefix, ...args], {
    cwd: project, timeout: 45_000,
  });
  await runOpenCode(["service", "set", "port", String(await freePort())]);
  try {
    let listed = "";
    const deadline = Date.now() + 15_000;
    do {
      listed = (await runOpenCode(["mcp", "list"])).stdout;
      if (listed.includes("picard-global-check")) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    assert.match(listed, /picard-global-check\s+disabled/, "the normal OpenCode command must see the same MCP server");
  } finally {
    await runOpenCode(["service", "stop"]);
  }
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
  assert.equal((await client.mcpServers(project))[0]?.name, "picard-global-check", "refreshing the crew must preserve MCP settings");
  assert.equal(await readFile(join(globalSettings, "opencode.json"), "utf8"), globalConfig, "global settings must not be changed");
  const blockedSettings = resolve(temporary, "blocked-settings");
  await mkdir(blockedSettings);
  const explicitFile = resolve(blockedSettings, "opencode.json");
  const explicitConfig = JSON.stringify({
    mcp: { servers: { "picard-explicit-check": { type: "remote", url: "http://127.0.0.1:1/mcp", disabled: true } } },
  });
  await writeFile(explicitFile, explicitConfig);
  for (const customFolder of [false, true]) {
    process.env.OPENCODE_CONFIG = explicitFile;
    if (customFolder) process.env.OPENCODE_CONFIG_DIR = globalSettings;
    const withoutCrew = await startEngine(project);
    try {
      assert.match(withoutCrew.crewProblem ?? "", /OPENCODE_CONFIG/, "an occupied explicit settings file must not hide normal global settings");
      assert.equal((await withoutCrew.client.info()).version, info.version, "the computer stays available without the crew");
      assert.equal(verifiedCrew(await withoutCrew.client.agents(project)), false);
      assert.deepEqual((await withoutCrew.client.mcpServers(project)).map(({ name }) => name).sort(),
        ["picard-explicit-check", "picard-global-check"]);
      assert.equal(await readFile(explicitFile, "utf8"), explicitConfig);
    } finally { await withoutCrew.close(); }
  }
  delete process.env.OPENCODE_CONFIG;
  process.env.OPENCODE_CONFIG_DIR = globalSettings;
  process.env.OPENCODE_PASSWORD = "picard-live-check-inherited-password";
  const customDirectory = await startEngine(project);
  try {
    assert.equal(customDirectory.crewProblem, undefined, "a custom settings folder must still support the crew");
    assert.equal((await customDirectory.client.mcpServers(project))[0]?.name, "picard-global-check");
  } finally { await customDirectory.close(); }
  const models = await availableModels(client, project);
  console.log(`Real OpenCode ${info.version}: startup, project context, saved conversation, event stream, and approval/question endpoints passed.`);
  console.log("Global MCP settings match OpenCode's management command and survive crew refresh without changing the saved file. Custom settings folders and inherited passwords passed. An occupied settings file preserves MCP connections and explains why the crew is unavailable.");
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
    await rm(settings, { recursive: true });
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (engine?.child.pid) {
      assert.ok(engine.child.exitCode !== null || engine.child.signalCode !== null, "The owned OpenCode process must stop.");
    }
  }
}
