import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { SpeechService, SpeechInput } from "./speech-types.js";
import type { SpeechEvent, VoicePhase } from "../shared/speech.js";
import { crewMember, type CrewID } from "../shared/crew.js";

interface SpokenPart { text: string; speaker?: CrewID }
// A short pause when the next part has a different speaker: 0.3 seconds of 24 kHz 16-bit silence.
const HANDOVER = Buffer.alloc(14_400);

/** A spoken reply is either one text for the computer or up to eight parts, each spoken by the computer or an officer. */
function spokenParts(data: object): SpokenPart[] | undefined {
  if ("text" in data && !("parts" in data)) return typeof data.text === "string" && data.text.trim() && data.text.length <= 1000 ? [{ text: data.text.trim() }] : undefined;
  if (!("parts" in data) || !Array.isArray(data.parts) || !data.parts.length || data.parts.length > 8) return undefined;
  const parts: SpokenPart[] = [];
  for (const part of data.parts as unknown[]) {
    if (!part || typeof part !== "object" || !("text" in part) || typeof part.text !== "string" || !part.text.trim() || part.text.length > 1000) return undefined;
    const speaker = "speaker" in part ? part.speaker : undefined;
    if (speaker !== undefined && (typeof speaker !== "string" || !crewMember(speaker))) return undefined;
    parts.push({ text: part.text.trim(), ...speaker === undefined ? {} : { speaker: speaker as CrewID } });
  }
  return parts;
}

/**
 * `source` may be a fixed service or a function, so speech settings can change while the app runs.
 * Each browser connection keeps the service it started with; call `disconnect` after a change.
 */
export function attachSpeech(server: Server, source: SpeechService | undefined | (() => SpeechService | undefined), allowed: (request: IncomingMessage) => boolean) {
  const service = () => typeof source === "function" ? source() : source;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65_536 });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/api/speech" || !allowed(request)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    if (!service()) { socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"); return; }
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit("connection", client));
  });
  sockets.on("connection", (socket) => {
    const chosen = service();
    if (!chosen) { socket.close(1013, "Speech is not set up."); return; }
    let phase: VoicePhase = "off";
    let input: SpeechInput | undefined;
    let listening: AbortController | undefined;
    let speaking: AbortController | undefined;
    let epoch = 0;
    let speechEpoch = 0;
    let audioBytes = 0;
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    const send = (event: SpeechEvent) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
    };
    const state = (next: VoicePhase, id?: number) => { phase = next; send(id === undefined ? { type: "state", phase } : { type: "state", phase, id }); };
    const stopListening = () => {
      ++epoch;
      clearTimeout(commitTimer);
      listening?.abort();
      listening = undefined;
      input?.close();
      input = undefined;
      audioBytes = 0;
    };
    const stopSpeaking = () => { ++speechEpoch; speaking?.abort(); speaking = undefined; };
    const stop = () => { stopListening(); stopSpeaking(); };
    const fail = (message: string) => { stop(); state("off"); send({ type: "error", message }); };
    const listen = async (id?: number) => {
      stopListening();
      const current = epoch;
      listening = new AbortController();
      state("thinking");
      try {
        const next = await chosen.listen({
          partial: (text) => { if (epoch === current) send({ type: "partial", text }); },
          final: (text) => {
            if (epoch !== current || phase !== "thinking") return;
            clearTimeout(commitTimer);
            input?.close();
            input = undefined;
            send({ type: "transcript", text });
          },
          error: (message) => { if (epoch === current) fail(message); },
        }, listening.signal);
        if (epoch !== current) { next.close(); return; }
        input = next;
        state("listening", id);
      } catch (error) {
        if (epoch === current) fail(error instanceof Error ? error.message : "Could not start the selected listening service.");
      }
    };
    const speak = async (parts: SpokenPart[], id: number) => {
      stopSpeaking();
      const current = speechEpoch;
      speaking = new AbortController();
      const signal = speaking.signal;
      send({ type: "state", phase: "thinking" });
      let started = false;
      const play = (bytes: Uint8Array) => {
        if (socket.bufferedAmount > 1_000_000) throw new Error("Spoken playback fell behind. Speaking was stopped; the written answer remains on screen.");
        if (!started) {
          started = true;
          send({ type: "state", phase: "speaking" });
          send({ type: "audio-start", rate: 24000, id });
        }
        socket.send(bytes, { binary: true });
      };
      let previous: SpokenPart | undefined;
      let part: SpokenPart | undefined;
      try {
        for (part of parts) {
          // The voice is chosen before any audio, so a missing officer voice never sounds like the computer.
          const voice = part.speaker ? chosen.officerVoice?.(part.speaker) : undefined;
          if (part.speaker && !voice) throw new Error("This speaking service has no officer voices.");
          if (previous && previous.speaker !== part.speaker) play(HANDOVER);
          previous = part;
          let remainder = Buffer.alloc(0);
          let produced = false;
          for await (const bytes of chosen.speak(part.text, signal, voice)) {
            if (speechEpoch !== current || socket.readyState !== WebSocket.OPEN) return;
            const joined = Buffer.concat([remainder, bytes]);
            const end = joined.length - joined.length % 2;
            if (end) { produced = true; play(joined.subarray(0, end)); }
            remainder = Buffer.from(joined.subarray(end));
          }
          if (speechEpoch !== current) return;
          if (remainder.length) throw new Error("The speaking service returned incomplete audio. The written answer remains on screen.");
          if (!produced) throw new Error("No spoken audio was produced. The written answer remains on screen.");
        }
        send({ type: "audio-end", id });
        // Remain paused until the browser finishes playing its queued audio.
      } catch (error) {
        if (speechEpoch !== current) return;
        const message = error instanceof Error ? error.message : "Could not speak the answer. Read it on screen.";
        fail(part?.speaker ? `${crewMember(part.speaker)!.name}'s voice could not be spoken. ${message}` : message);
      }
    };
    socket.on("message", (raw, binary) => {
      try {
        if (binary) {
          if (phase !== "listening" || !input) return;
          const bytes = Buffer.isBuffer(raw) ? raw : Buffer.concat(Array.isArray(raw) ? raw : [Buffer.from(raw)]);
          if (!bytes.length || bytes.length % 2 || bytes.length > 2560) throw new Error("Microphone audio must contain small, complete 16-bit audio samples.");
          audioBytes += bytes.length;
          if (audioBytes > 16000 * 2 * 3600) throw new Error("Listening reached the service's one-hour limit. Click the microphone button to listen again.");
          input.write(bytes);
          return;
        }
        const data: unknown = JSON.parse(raw.toString());
        if (!data || typeof data !== "object" || !("type" in data)) throw new Error("The voice request is not valid.");
        if (data.type === "listen") {
          const id = "id" in data ? data.id : undefined;
          if (id !== undefined && !(typeof id === "number" && Number.isSafeInteger(id) && id > 0)) throw new Error("The voice request is not valid.");
          void listen(id);
        }
        else if (data.type === "pause") {
          stopListening();
          phase = "off";
          if (!speaking) state("off");
        } else if (data.type === "commit") {
          if (phase !== "listening" || !input || !audioBytes) throw new Error("No spoken audio is waiting.");
          state("thinking");
          commitTimer = setTimeout(() => fail("The listening service did not finish understanding the request. Click the microphone button to listen again."), 30_000);
          input.commit();
        } else if (data.type === "stop-speaking") { stopSpeaking(); send({ type: "state", phase: "off" }); }
        else if (data.type === "speak" && "id" in data && typeof data.id === "number" && Number.isSafeInteger(data.id) && data.id > 0) {
          const parts = spokenParts(data);
          if (!parts) throw new Error("That voice request is not available.");
          void speak(parts, data.id);
        } else throw new Error("That voice request is not available.");
      } catch (error) { fail(error instanceof Error ? error.message : "The voice request failed."); }
    });
    socket.on("close", stop);
    socket.on("error", stop);
  });
  const disconnect = () => { for (const socket of sockets.clients) socket.close(1012, "Speech settings changed. Listening starts again."); };
  return Object.assign(() => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
  }, { disconnect });
}
