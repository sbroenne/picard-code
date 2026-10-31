# Picard Code

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

A tribute to Sir Patrick Stewart and Captain Jean-Luc Picard, made with deep
respect and gratitude. You code by voice, as the captain spoke to the ship's
computer. Technically, a simple local browser interface for OpenCode with an
original computer-display design inspired by Star Trek: The Next Generation.

## Operating Context

Runs locally on Windows, macOS, and Linux. Node.js and OpenCode are prerequisites.
The user chooses a project folder and connects an AI provider through OpenCode.
OpenCode performs the coding work, with any model provider it supports.

## Capabilities and Constraints

The first version needs saved conversations, live replies, project-folder
context, and real OpenCode approval requests. Credentials stay out of the
browser. Services listen locally and must reject requests from unrelated
websites. A future published package may support `npx picard-code`; publication
is not part of the first version.

Spoken requests are the only input; there is no typing fallback. The app is
designed for a computer screen, not a phone. The microphone starts on when
speech is ready, subject to browser permission and sound restrictions.
"Computer" begins a task; follow-ups need no prefix until the user returns to
standing by. End-of-speech detection sends ordinary requests
without routine transcript review or a Send step. Brief spoken answers accompany
full written results. Follow-ups keep context; microphone off, stop speaking,
and Belay that (stop work) have separate meanings. Decisions remain deliberate.
Listening pauses during playback and settings changes; requests heard while
work or a decision is pending are not sent.

Use the supported MAI live listening and prebuilt MAI speaking services.
Azure listening receives detected speech before deciding whether "Computer"
was said, including speech not meant for the model. Processing can occur
outside Europe. Standing by still listens; microphone off stops capture.
Keys remain in local server memory;
connection settings contain no secrets. Reuse suitable resources on the
explicitly approved subscription without changing spending limits or access.

Listening and speaking share small, separate interfaces. Real CPU Whisper
listening and Kokoro speaking are independently selectable alternatives.
Both use the same automatic conversation loop and deliberate decisions, with
no silent fallback. Local audio processing needs no Azure credentials;
recognized coding requests still go to the chosen model.

Any model provider OpenCode supports can be used, such as GitHub Copilot,
Anthropic, OpenAI or a local model. Sign-ins go through OpenCode's own flow and
stay with OpenCode; credentials from other tools must not be extracted.

## Brand Commitments

Picard Code. Plain English. Black background, peach, orange, and lilac panels,
rounded side bars, and readable conversation text. No copied franchise assets
or implied endorsement.

The computer's writing should be brief, precise, and neutral. Use original
phrasing, truthful acknowledgments, explicit uncertainty, and useful errors.
No voice cloning, show dialogue, or recordings in the repository. Three short
computer sounds chosen by the project owner are an optional separate download,
used with the owner's confirmed permission; they accompany, never replace,
the visible and spoken explanation. No fictional ship status, repetitive
catchphrases, or claims that work succeeded before the real result arrives.

The owner prefers the British prebuilt voices: MAI Emily (neutral style) by
default, with Kokoro `bf_emma` as the local default. This is a preference for
British delivery, not a claim of authenticity.

The user is always Captain Jean-Luc Picard, labeled "Picard" on screen.
The computer says "Captain" occasionally. Use the plain TNG terms in AGENTS.md:
Captain's log, log entry, Stardate, and Standing by. Settings open from the
side-panel tiles; earlier entries are kept in Captain's log.

## Evidence on Hand

The OpenCode 2 server description and provider documentation, implemented
through Picard Code's own small client. Automated
checks cover the local connection and interface; real OpenCode startup, saved
conversations, event subscription, and shutdown are verified on Windows.
Real Azure speaking and live MAI listening are verified with an original
synthesized phrase. Automated browser checks exercise actual microphone capture
using test audio and check the spoken loop on a desktop layout.
Real local Kokoro synthesis, Whisper recognition, cancellation, and fresh
listening are verified. Both MAI and Whisper/Kokoro complete a real browser
conversation through OpenCode and the user's authorized GitHub Copilot (the provider
used for the real checks so far),
with saved replies and actual spoken playback. A real six-turn conversation
check covers follow-ups, a correction, "show me", OpenCode's real question
and a refused command. Those real-service checks predate OpenCode 2; the
migration passed automated stand-in checks but did not rerun real model or
Azure checks. Fresh OpenCode 2 real-service checks, physical microphone/speaker,
subjective voice and timing review, and real macOS/Linux use remain unverified.
