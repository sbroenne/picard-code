import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { runDevelopment } from "./dev.mjs";

function launcherFixture() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 12345, exitCode: null, signalCode: null, stdout: new EventEmitter() });
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    child.signalCode = signal;
    child.emit("exit", null, signal);
  };
  const spawn = () => {
    queueMicrotask(() => child.stdout.emit("data", "http://127.0.0.1:12345/#token=abc123"));
    return child;
  };
  return { child, spawn, signals };
}

test("a failed browser launch leaves both servers running until normal shutdown", async (t) => {
  const fixture = launcherFixture();
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));
  let closed = false;
  let opened;
  const attempted = new Promise((resolve) => { opened = resolve; });
  const running = runDevelopment({
    spawn: fixture.spawn,
    platform: "linux",
    startDevelopmentServer: async () => ({ origin: "http://127.0.0.1:12346", close: async () => { closed = true; } }),
    openBrowser: async () => { opened(); throw new Error("xdg-open is missing"); },
  });
  await attempted;
  // Let the launcher's catch handle the rejection before checking its state.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  assert.deepEqual(fixture.signals, []);
  assert.match(errors[0], /xdg-open is missing/);
  assert.match(errors[0], /Open the full live browser updates address/);
  process.emit("SIGTERM");
  assert.equal(await running, 0);
  assert.equal(closed, true);
  assert.deepEqual(fixture.signals, ["SIGTERM"]);
});

for (const failure of [false, true]) {
  test(`Windows ${failure ? "startup failure" : "shutdown"} stops the owned process tree`, async (t) => {
    const fixture = launcherFixture();
    t.mock.method(console, "error", () => {});
    let stopped = 0;
    let closed = false;
    const running = runDevelopment({
      spawn: fixture.spawn,
      platform: "win32",
      stopOwnedProcess: async (child) => {
        assert.equal(child, fixture.child);
        stopped++;
        child.exitCode = 0;
        child.emit("exit", 0, null);
      },
      startDevelopmentServer: async () => {
        if (failure) throw new Error("The development port could not open.");
        return { origin: "http://127.0.0.1:12346", close: async () => { closed = true; } };
      },
      openBrowser: async () => { process.emit("SIGTERM"); },
    });
    assert.equal(await running, failure ? 1 : 0);
    assert.equal(stopped, 1);
    assert.deepEqual(fixture.signals, []);
    assert.equal(closed, !failure);
  });
}
