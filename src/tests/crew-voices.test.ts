import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { setTimeout as wait } from "node:timers/promises";
import { BRIDGE_CREW, type CrewID } from "../shared/crew.js";
import { CREW_VOICES, crewVoice } from "../shared/crew-voices.js";
import type { SpeechEvent } from "../shared/speech.js";
import { azureSpeech } from "../server/azure-speech.js";
import { attachSpeech } from "../server/speech-bridge.js";
import type { SpeechService } from "../server/speech-types.js";
import { speechFixture } from "./speech-fixture.js";

const FEMALE: CrewID[] = ["picard-troi", "picard-crusher"];
const FEMALE_MAI = new Set(["en-GB-Emily", "en-US-Harper", "en-US-Iris", "en-US-Olivia", "en-AU-Isla", "en-IN-Priya"]);
const COMPUTER = { voice: "en-GB-Emily:MAI-Voice-2.1-Flash", kokoroVoice: "bf_emma" };

test("each officer has a distinct ready-made voice of the right gender on both services", () => {
  assert.deepEqual(Object.keys(CREW_VOICES).sort(), BRIDGE_CREW.map((officer) => officer.id).sort());
  for (const speaking of ["kokoro", "mai"] as const) {
    const chosen = BRIDGE_CREW.map((officer) => crewVoice(officer.id, speaking, COMPUTER).name);
    assert.equal(new Set(chosen).size, chosen.length, `${speaking} officers must not share a voice`);
    for (const officer of BRIDGE_CREW) {
      const female = FEMALE.includes(officer.id);
      for (const choice of CREW_VOICES[officer.id][speaking]) {
        if (speaking === "kokoro") assert.equal(choice.voice[1], female ? "f" : "m", `${officer.name}: ${choice.voice}`);
        else assert.equal(FEMALE_MAI.has(choice.voice), female, `${officer.name}: ${choice.voice}`);
      }
      assert.notEqual(crewVoice(officer.id, speaking, COMPUTER).name.split(":")[0], speaking === "kokoro" ? COMPUTER.kokoroVoice : "en-GB-Emily");
    }
  }
});

test("an officer never speaks with the computer's own voice, and MAI officers follow the computer's model", () => {
  for (const officer of BRIDGE_CREW) {
    const [first, second] = CREW_VOICES[officer.id].kokoro;
    assert.equal(crewVoice(officer.id, "kokoro", { ...COMPUTER, kokoroVoice: first.voice }).name, second.voice);
    const [maiFirst, maiSecond] = CREW_VOICES[officer.id].mai;
    const voice = crewVoice(officer.id, "mai", { ...COMPUTER, voice: `${maiFirst.voice}:MAI-Voice-2.1` });
    assert.equal(voice.name, `${maiSecond.voice}:MAI-Voice-2.1`);
    assert.ok(voice.style);
  }
  assert.match(crewVoice("picard-data", "mai", { ...COMPUTER, voice: "en-GB-Emily" }).name, /:MAI-Voice-2\.1-Flash$/);
});

async function connect(t: { after(fn: () => unknown): void }, service: SpeechService) {
  const server = createServer((_request, response) => response.end());
  let origin = "";
  const close = attachSpeech(server, service, (request) => request.headers.origin === origin);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { close(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/speech`, { headers: { Origin: origin } });
  const events: SpeechEvent[] = [];
  let audio = 0;
  socket.on("message", (data, binary) => {
    if (binary) audio += Buffer.isBuffer(data) ? data.length : 0;
    else events.push(JSON.parse(data.toString()));
  });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  t.after(() => socket.terminate());
  const next = async (type: SpeechEvent["type"]) => {
    const deadline = AbortSignal.timeout(3000);
    while (true) {
      const index = events.findIndex((event) => event.type === type);
      if (index >= 0) return events.splice(index, 1)[0]!;
      await wait(5, undefined, { signal: deadline });
    }
  };
  return { socket, events, next, get audio() { return audio; } };
}

test("a briefing is spoken in order, each officer in their own voice, as one answer with short pauses between speakers", async (t) => {
  const fixture = speechFixture("Hello computer", 0.1);
  const voice = await connect(t, fixture.service);
  voice.socket.send(JSON.stringify({ type: "speak", id: 4, parts: [
    { text: "Data found two failing tests.", speaker: "picard-data" },
    { text: "Worf sees no security risk.", speaker: "picard-worf" },
    { text: "Riker recommends fixing the tests first.", speaker: "picard-riker" },
    { text: "The decision is yours, Captain." },
  ] }));
  await voice.next("audio-end");
  assert.deepEqual(fixture.said, [
    { text: "Data found two failing tests.", voice: { name: "test-picard-data" } },
    { text: "Worf sees no security risk.", voice: { name: "test-picard-worf" } },
    { text: "Riker recommends fixing the tests first.", voice: { name: "test-picard-riker" } },
    { text: "The decision is yours, Captain." },
  ]);
  assert.equal(voice.events.filter((event) => event.type === "audio-start").length, 1, "one answer, started once");
  assert.equal(voice.audio, 4 * 4800 + 3 * 14_400, "four answers and three 0.3 second pauses");
});

test("spoken parts are checked, and a failed officer voice is named instead of sounding like the computer", async (t) => {
  const fixture = speechFixture("Hello computer", 0.1);
  const voice = await connect(t, fixture.service);
  for (const parts of [[], [{ text: "Hello.", speaker: "picard-q" }], [{ text: " " }], Array.from({ length: 9 }, () => ({ text: "Too many." })), [{ text: "x".repeat(1001) }]]) {
    voice.socket.send(JSON.stringify({ type: "speak", id: 1, parts }));
    const error = await voice.next("error");
    assert.ok(error.type === "error" && error.message, JSON.stringify(parts));
  }
  assert.equal(fixture.said.length, 0, "nothing invalid is spoken");

  const failing: SpeechService = {
    ...fixture.service,
    async *speak(text, signal, chosen) {
      if (chosen) throw new Error("Azure rejected the voice en-US-Sage.");
      yield* fixture.service.speak(text, signal);
    },
  };
  const broken = await connect(t, failing);
  broken.socket.send(JSON.stringify({ type: "speak", id: 2, parts: [{ text: "Ready." }, { text: "No risk.", speaker: "picard-worf" }] }));
  const error = await broken.next("error");
  assert.equal(error.type === "error" && error.message, "Worf's voice could not be spoken. Azure rejected the voice en-US-Sage.");

  const noVoices: SpeechService = { ...fixture.service, officerVoice: undefined };
  const plain = await connect(t, noVoices);
  plain.socket.send(JSON.stringify({ type: "speak", id: 3, parts: [{ text: "No risk.", speaker: "picard-worf" }] }));
  const missing = await plain.next("error");
  assert.match(missing.type === "error" ? missing.message : "", /^Worf's voice could not be spoken\. This speaking service has no officer voices\./);
});

test("Azure speaks an officer's part with that officer's voice and style", async (t) => {
  const bodies: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body));
    return new Response(new Uint8Array(480), { status: 200 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  const azure = azureSpeech({ subscription: "s", resourceGroup: "g", resourceName: "r", region: "swedencentral", voice: "en-GB-Emily:MAI-Voice-2.1-Flash", voiceStyle: "neutral" }, "test-key");
  for await (const _chunk of azure.speak("Aye, Captain.", AbortSignal.timeout(1000), { name: "en-US-Sage:MAI-Voice-2.1-Flash", style: "serious" })) { /* drain */ }
  for await (const _chunk of azure.speak("Ready.", AbortSignal.timeout(1000))) { /* drain */ }
  assert.match(bodies[0]!, /<voice name="en-US-Sage:MAI-Voice-2\.1-Flash"><mstts:express-as style="serious">Aye, Captain\./);
  assert.match(bodies[1]!, /<voice name="en-GB-Emily:MAI-Voice-2\.1-Flash"><mstts:express-as style="neutral">Ready\./);
});
