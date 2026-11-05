import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { setTimeout as wait } from "node:timers/promises";
import { BRIDGE_CREW, type CrewID } from "../shared/crew.js";
import { COMPUTER_VOICES, CREW_VOICES, crewVoice } from "../shared/crew-voices.js";
import type { SpeechEvent } from "../shared/speech.js";
import { azureSpeech } from "../server/azure-speech.js";
import { attachSpeech, SPEECH_PIECE_CHARACTERS } from "../server/speech-bridge.js";
import type { SpeechService } from "../server/speech-types.js";
import { speechFixture } from "./speech-fixture.js";

const FEMALE: CrewID[] = ["picard-troi", "picard-crusher"];
const FEMALE_MAI = new Set(["en-GB-Emily", "en-US-Harper", "en-US-Iris", "en-US-Olivia", "en-AU-Isla", "en-IN-Priya"]);

test("each officer has a distinct ready-made voice of the right gender on both services", () => {
  assert.deepEqual(Object.keys(CREW_VOICES).sort(), BRIDGE_CREW.map((officer) => officer.id).sort());
  for (const speaking of ["kokoro", "mai"] as const) {
    const chosen = BRIDGE_CREW.map((officer) => crewVoice(officer.id, speaking).name);
    assert.equal(new Set(chosen).size, chosen.length, `${speaking} officers must not share a voice`);
    for (const officer of BRIDGE_CREW) {
      const female = FEMALE.includes(officer.id);
      const voice = CREW_VOICES[officer.id][speaking];
      if (speaking === "kokoro") {
        assert.equal(voice[1], female ? "f" : "m", `${officer.name}: ${voice}`);
        assert.match(voice, /^[ab][fm]_/, "Only American and British Kokoro voices are allowed.");
      } else {
        assert.equal(FEMALE_MAI.has(voice), female, `${officer.name}: ${voice}`);
        assert.match(voice, /^en-(US|GB|AU)-/, "French and Indian accents are not allowed.");
      }
      assert.notEqual(crewVoice(officer.id, speaking).name.split(":")[0], COMPUTER_VOICES[speaking].split(":")[0]);
    }
  }
});

test("the computer and officers have fixed voices and use the same MAI model", () => {
  assert.deepEqual(COMPUTER_VOICES, { kokoro: "af_alloy", mai: "en-US-Iris:MAI-Voice-2.1-Flash" });
  for (const officer of BRIDGE_CREW) {
    assert.equal(crewVoice(officer.id, "kokoro").name, CREW_VOICES[officer.id].kokoro);
    const voice = crewVoice(officer.id, "mai");
    assert.equal(voice.name, `${CREW_VOICES[officer.id].mai}:MAI-Voice-2.1-Flash`);
    assert.equal(voice.style, "neutral");
  }
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

test("a chosen speaking speed reaches every part, and a speed outside 0.8 to 1.2 is refused", async (t) => {
  const fixture = speechFixture("Hello computer", 0.1);
  const voice = await connect(t, fixture.service);
  for (const speed of [2, 0.5, "fast"]) {
    voice.socket.send(JSON.stringify({ type: "speak", id: 1, text: "Too fast.", speed }));
    const error = await voice.next("error");
    assert.equal(error.type === "error" && error.message, "The speaking speed must be between 0.8 and 1.2.");
  }
  voice.socket.send(JSON.stringify({ type: "speak", id: 2, speed: 1.1, parts: [{ text: "Ready.", speaker: "picard-data" }, { text: "Done." }] }));
  await voice.next("audio-end");
  assert.deepEqual(fixture.said, [{ text: "Ready.", voice: { name: "test-picard-data" }, speed: 1.1 }, { text: "Done.", speed: 1.1 }]);
});

test("long reports are spoken completely in bounded chunks with one voice, speed and playback", async (t) => {
  const fixture = speechFixture("Hello computer", 0.1);
  const voice = await connect(t, fixture.service);
  const report = `${"Captain, this is another part of the explanation. ".repeat(50)}This is the final point.`;
  voice.socket.send(JSON.stringify({ type: "speak", id: 1, speed: 1.1, parts: [
    { text: report, speaker: "picard-data" }, { text: "The decision is yours." },
  ] }));
  await voice.next("audio-end");
  assert.equal(fixture.said.slice(0, -1).map((part) => part.text).join(" "), report);
  assert.ok(fixture.said.every((part) => part.text.length <= SPEECH_PIECE_CHARACTERS && part.speed === 1.1));
  assert.ok(fixture.said.slice(0, -1).every((part) => part.voice?.name === "test-picard-data"));
  assert.equal(voice.events.filter((event) => event.type === "audio-start").length, 1);
  assert.equal(voice.audio, fixture.said.length * 4800 + 14_400, "no handover pauses between chunks of the same speaker");

  for (const text of ["x".repeat(8000), `${"x".repeat(SPEECH_PIECE_CHARACTERS - 1)}😀${"y".repeat(1000)}`]) {
    const before = fixture.said.length;
    voice.socket.send(JSON.stringify({ type: "speak", id: 2, text }));
    await voice.next("audio-end");
    const chunks = fixture.said.slice(before).map((part) => part.text);
    assert.ok(chunks.every((chunk) => chunk.length <= SPEECH_PIECE_CHARACTERS && Buffer.from(chunk).toString() === chunk));
    assert.equal(chunks.join(""), text);
  }
});

test("a long multi-paragraph answer is spoken completely at the slowest speed without reaching the per-request audio limit", async (t) => {
  // Paced like real Kokoro on dense text: about 9 characters a second at speed 0.8.
  // Like Kokoro and Azure, one request stops after 3,000,000 bytes (62.5 seconds of 24 kHz audio).
  const said: string[] = [];
  const voice = await connect(t, {
    ...speechFixture().service,
    async *speak(text, signal, _voice, speed = 1) {
      said.push(text);
      const seconds = Math.ceil(text.length / (11.25 * speed));
      for (let second = 0; second < seconds; second++) {
        signal.throwIfAborted();
        if ((second + 1) * 48_000 > 3_000_000) throw new Error("Kokoro returned incomplete or oversized audio.");
        yield Buffer.alloc(48_000);
        await wait(0);
      }
    },
  });
  const answer = [
    "Jean-Luc Picard was born in La Barre, France, and grew up on his family's vineyard. He entered Starfleet Academy and later commanded the Stargazer for more than twenty years.",
    "He then took command of the Enterprise. His crew valued his diplomacy, his patience and his firm sense of principle. He preferred talking to fighting, but he never shrank from a hard decision.",
    "He was taken by the Borg and returned, and that experience stayed with him for the rest of his life. He studied archaeology, read widely and enjoyed Shakespeare and Earl Grey tea.",
  ].map((paragraph) => paragraph.repeat(3)).join("\n\n");
  assert.ok(answer.length > 1500);
  voice.socket.send(JSON.stringify({ type: "speak", id: 1, speed: 0.8, text: answer }));
  const deadline = AbortSignal.timeout(3000);
  while (!voice.events.some((event) => event.type === "audio-end" || event.type === "error")) await wait(5, undefined, { signal: deadline });
  assert.deepEqual(voice.events.find((event) => event.type === "audio-end" || event.type === "error"), { type: "audio-end", id: 1 });
  assert.equal(said.join(" ").replace(/\s+/g, " "), answer.replace(/\s+/g, " "));
  assert.ok(said.every((piece) => piece.length <= SPEECH_PIECE_CHARACTERS && /[.!?]$/.test(piece)), "pieces end at sentence boundaries");
});

test("stopping a long reply prevents later chunks and does not corrupt the next reply", async (t) => {
  const fixture = speechFixture("Hello computer", 0.1);
  const said: string[] = [];
  const voice = await connect(t, {
    ...fixture.service,
    async *speak(text, signal) {
      said.push(text);
      yield Buffer.alloc(480);
      if (said.length === 1) {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        yield Buffer.alloc(480);
      }
    },
  });
  voice.socket.send(JSON.stringify({ type: "speak", id: 1, text: "This reply will be interrupted. ".repeat(100) }));
  await voice.next("audio-start");
  voice.events.length = 0;
  voice.socket.send(JSON.stringify({ type: "stop-speaking" }));
  const stopped = await voice.next("state");
  assert.equal(stopped.type === "state" && stopped.phase, "off");
  await wait(25);
  assert.equal(said.length, 1, "no later chunk starts after cancellation");
  assert.ok(!voice.events.some((event) => event.type === "audio-end" || event.type === "error"));
  voice.socket.send(JSON.stringify({ type: "speak", id: 2, text: "The new reply is complete." }));
  const finished = await voice.next("audio-end");
  assert.equal(finished.type === "audio-end" && finished.id, 2);
  assert.equal(said.at(-1), "The new reply is complete.");
});

test("spoken parts are checked, and a failed officer voice is named instead of sounding like the computer", async (t) => {
  const fixture = speechFixture("Hello computer", 0.1);
  const voice = await connect(t, fixture.service);
  for (const parts of [[], [{ text: "Hello.", speaker: "picard-q" }], [{ text: " " }], Array.from({ length: 9 }, () => ({ text: "Too many." })), [{ text: "x".repeat(8001) }], [{ text: "x".repeat(4001) }, { text: "y".repeat(4000) }]]) {
    voice.socket.send(JSON.stringify({ type: "speak", id: 1, parts }));
    const error = await voice.next("error");
    assert.ok(error.type === "error" && error.message, JSON.stringify(parts));
  }
  voice.socket.send(JSON.stringify({ type: "speak", id: 1, text: "x".repeat(8001) }));
  const tooLong = await voice.next("error");
  assert.equal(tooLong.type === "error" && tooLong.message, "The spoken answer is too long. The written answer remains on screen.");
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
