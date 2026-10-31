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
OpenCode, not the Copilot SDK, performs the coding work.

## Capabilities and Constraints

The first version needs saved conversations, live replies, project-folder
context, and real OpenCode approval requests. Credentials stay out of the
browser. Services listen locally and must reject requests from unrelated
websites. A future published package may support `npx picard-code`; publication
is not part of the first version.

Spoken conversation is the main experience. Explicit microphone activation
starts the selected listening service. End-of-speech detection sends ordinary requests
without routine transcript review or a Send step. Brief spoken answers accompany
full written results. Follow-ups keep context; microphone off, stop speaking,
and stop work have separate meanings. Typing is a fallback. Decisions remain
deliberate and listening is paused while work, approvals, or playback are active.

Use the supported MAI live listening and prebuilt MAI speaking services.
Microphone audio goes to Azure only after activation, with a clear disclosure
that processing can occur outside Europe. Keys remain in local server memory;
connection settings contain no secrets. Reuse suitable resources on the
explicitly approved subscription without changing spending limits or access.

Listening and speaking share small, separate interfaces. Real CPU Whisper
listening and Kokoro speaking are independently selectable alternatives.
Both use the same automatic conversation loop and deliberate decisions, with
no silent fallback. Local audio processing needs no Azure credentials;
recognized coding requests still go to Copilot.

GitHub Copilot is the chosen AI provider, accessed through OpenCode's supported
connection flow. The user approves the official GitHub device sign-in. Existing
OpenCode authorization can be reused; unrelated GitHub or Copilot credentials
must not be extracted.

## Brand Commitments

Picard Code. Plain English. Black background, peach, orange, and lilac panels,
rounded side bars, and readable conversation text. No copied franchise assets
or implied endorsement.

The computer's writing should be brief, precise, and neutral. Use original
phrasing, truthful acknowledgments, explicit uncertainty, and useful errors.
No voice cloning, show dialogue, or recordings in the repository. Four short
computer sounds chosen by the project owner are an optional separate download,
used with the owner's confirmed permission; they accompany, never replace,
the visible and spoken explanation. No fictional ship status, repetitive
catchphrases, or claims that work succeeded before the real result arrives.

The owner prefers the British prebuilt voices: MAI Emily (neutral style) by
default, with Kokoro `bf_emma` as the local default. This is a preference for
British delivery, not a claim of authenticity.

## Evidence on Hand

The official OpenCode server, SDK, and Copilot setup documentation. Automated
checks cover the local connection and interface; real OpenCode startup, saved
conversations, event subscription, and shutdown are verified on Windows.
Real Azure speaking and live MAI listening are verified with an original
synthesized phrase. Automated browser checks exercise actual microphone capture
using test audio and check the conversation loop on desktop and phone layouts.
Real local Kokoro synthesis, Whisper recognition, cancellation, and fresh
listening are verified. Both MAI and Whisper/Kokoro complete a real browser
conversation through OpenCode and the user's authorized GitHub Copilot,
with saved replies and actual spoken playback. A real six-turn conversation
check covers follow-ups, a correction, "show me", OpenCode's real question
and a refused command. Physical microphone/speaker, subjective voice and
timing review, and macOS/Linux checks remain unverified.
