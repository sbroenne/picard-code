import { Effect, Stream } from "effect";
import { githubDeviceSignIn, GITHUB_DEVICE_METHOD, usesGithubDevice } from "../../dist/server/github-device.js";

// OpenCode supplies its own Effect runtime and owns the attempt, cancellation, credentials and renewal.
export default {
  id: "picard.github.mcp",
  effect: ctx => Effect.gen(function* () {
    const targets = new Map();
    let bindings = new Map();
    const refresh = Effect.gen(function* () {
      const servers = yield* ctx.mcp.list({});
      const next = new Map(servers.data.flatMap(server => {
        const config = targets.get(server.name);
        return config && server.integrationID ? [[server.integrationID, config]] : [];
      }));
      if (JSON.stringify([...next]) === JSON.stringify([...bindings])) return;
      bindings = next;
      yield* ctx.integration.reload();
    });
    yield* ctx.event.subscribe({ types: ["mcp.status.changed"] }).pipe(
      Stream.runForEach(() => refresh),
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* ctx.mcp.transform(editor => {
      targets.clear();
      for (const [name, config] of editor.list()) if (usesGithubDevice(config)) targets.set(name, config);
    });
    yield* ctx.integration.transform(editor => {
      for (const [integrationID, config] of bindings) {
        editor.method.update({
          integrationID,
          method: { id: GITHUB_DEVICE_METHOD, type: "oauth", label: "Sign in to GitHub with a one-time code" },
          authorize: () => Effect.tryPromise({
            try: signal => githubDeviceSignIn(config.url, config.oauth?.scope, signal),
            catch: error => error,
          }).pipe(Effect.map(attempt => ({
            mode: "auto", url: attempt.url, instructions: attempt.instructions, expiresAt: attempt.expiresAt,
            callback: Effect.tryPromise({ try: signal => attempt.complete(signal), catch: error => error }),
          }))),
        });
      }
    });
    yield* refresh;
  }),
};
