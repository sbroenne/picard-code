# Picard Code: conversation and voice direction

> **Status.** The first sections describe the app **before** the conversation fixes, and the voice comparison that followed. The final section, *What was implemented and checked*, describes the current build. Audio samples are not stored in this repository; the measurement files are in [audition-data](audition-data/).

## Why the current version does not yet achieve the tribute

The current implementation proves that listening, coding, and playback connect. It does not prove that the interaction resembles the Enterprise computer.

The following findings come from the implemented code, not from listening to its audio:

| Current behavior | Why it weakens the intended experience | Direction to evaluate |
|---|---|---|
| One general instruction asks for a brief opening paragraph. | An operational answer, explanation, clarification, and approval need different shapes; shortening a chat response is not sufficient. | Choose the response shape according to the actual situation. |
| Speech is selected from the first paragraph once work finishes. | The spoken channel is an excerpt of a written answer, rather than a deliberately composed conversational turn. | Provide a concise spoken answer alongside the full visible result, grounded in the same facts. |
| An OpenCode question produces a generic notice to answer on screen. | The computer does not actually ask the missing question aloud or accept the spoken answer. | Speak the actual question and route the answer to that exact pending question. |
| Listening pauses during work, decisions, and playback. | The user cannot make a spoken correction or interruption at those moments. | Assess safe interruption and correction handling instead of equating automatic submission with natural conversation. |
| Stop speaking is a button, separate from Stop work. | These controls are useful, but voice-over-voice interruption is not implemented. | Retain the controls and investigate spoken interruption without accepting the app's own speech as user input. |
| The Azure speaking request supplies text and a voice, with no explicit delivery direction. | A stock voice's default delivery is doing most of the stylistic work. | Audition supported controls and different prebuilt voices; do not assume any requested control takes effect. |

Sources in the application: `src/server/instructions.ts`, `src/shared/speech.ts`, `web/main.ts`, `web/voice.ts`, and `src/server/azure-speech.ts`.

## What should be recognizable

The useful reference is not an actor's identity. It is purposeful interaction:

- A question has a definite subject.
- The answer supplies the requested fact without a chatty preamble.
- A follow-up can be very short because the context remains active.
- Missing information produces a specific question.
- A display command leads to visible information rather than a long spoken reading.
- A limitation is stated directly, with its actual cause where known.
- An action and an assessment remain distinct.
- A consequential operation requires real authorization, not fictional rank or voice codes.

Picard's speech remains human. He asks questions, qualifies requests, reacts, and changes direction. Turning all user speech into abrupt commands would lose part of the relationship.

## Evidence to use, and evidence not to overstate

The earlier report supplies dialogue evidence from seven episode transcripts, with a production-draft comparison for *11001001*:

- [11001001](http://www.chakoteya.net/NextGen/116.htm): Picard's contextual investigation following the alert; Riker's clarification exchange is evidence for the computer, not Picard.
- [Lessons](http://www.chakoteya.net/NextGen/245.htm): requested information is unavailable for a specific operational reason; Picard's reaction is different from the computer's response.
- [Where Silence Has Lease](http://www.chakoteya.net/NextGen/128.htm): a question about a missing time parameter and a location answer used to expose an illusion.
- [Ship in a Bottle](http://www.chakoteya.net/NextGen/238.htm): distinguish the simulated bridge's denials from real holodeck commands.
- [The Defector](http://www.chakoteya.net/NextGen/158.htm): a meaningful incoming event can initiate a computer announcement and a short follow-up.

These are mostly unofficial aired-episode transcriptions. They establish words and relationships, not measured pauses, pitch, sound effects, or rhythm.

Additional targeted searches did not establish a usable official scene clip or a first-hand account specifying TNG delivery measurements. One search returned conflicting video identifiers; another summarized delivery and recording claims without primary support. Those claims are excluded.

The official [The Sound of Their Voices](https://www.startrek.com/news/the-sound-of-their-voices) is a casting reference, not a guide to timing.

**Audio-reference limitation:** no episode audio was inspected or measured in this research. Voice and timing recommendations below are original hypotheses to audition, not proven reconstructions. The user's listening comparison is necessary before settling the direction.

## Original conversation scripts for evaluation

These examples are newly written, fictional demonstrations. Their findings and completion statements are not claims about real operations.

### Investigation and short follow-ups

**User:** Computer, why did the last build fail?

**Computer:** The release check failed. Two required settings are missing.

**User:** Which settings?

**Computer:** The service address and signing certificate.

**User:** Show me.

**Computer:** The details are on screen.

The point is continuity: no repeated introduction, no retelling of the entire investigation, and no reading the configuration file aloud.

### A real missing detail

**User:** Compare the two versions.

**Computer:** Which versions?

**User:** This branch and main.

**Computer:** Three files differ. The comparison is on screen.

The actual application must resolve or ask about the branches. A vague request must not silently select arbitrary versions.

### Unknown cause

**User:** Computer, why did the deployment time out?

**Computer:** The available logs do not establish the cause.

**User:** Check the earlier attempt.

**Computer:** The earlier attempt failed at the same connection step.

The second answer is appropriate only if the investigation supports it. Repeating a theatrical refusal would not advance the conversation.

### Correction that changes permission

**User:** Rename `userId` to `accountId`. This file only.

**User:** No. Do not edit yet. Show the occurrences.

**Computer:** Three occurrences are displayed. No changes made.

A live implementation must honor the correction and account for any action already started. It cannot claim that nothing changed simply because a correction arrived.

### Assessment is not approval

**User:** Could we publish this branch?

**Computer:** It can be published after the failing check is resolved.

This is a feasibility exchange. It is not authorization to publish.

For an explicit publication request, the computer should name what will be published and ask for the necessary approval. Real account and repository permissions still apply.

## Two-way wording

Use the existing OpenCode model to explore captain-style renderings. Keep the original recognized request as the authority; a more formal rendering can be a visible optional layer.

Example:

**Ordinary request:** Can you look at the failing login checks? Please do not change anything.

**Possible rendering:** Computer, investigate the failing login checks. Make no changes.

This preserves the scope and restriction. It must not become a repair request.

Do not automatically speak the rendering before every answer. That would make the app recite the user's instruction back to them and lengthen the exchange.

The audition should show original and rendered requests side by side, including questions, negation, corrections, and exact identifiers. Styling must not erase ambiguity or widen permission.

## Voice audition, not imitation

Use original prebuilt voices. Compare the current MAI voice with suitable alternatives and supported delivery settings, and include Kokoro as a local baseline.

For each candidate, record:

- Voice and actual settings used.
- Whether the service accepts and applies the requested controls.
- Time to the first audio and total speaking duration.
- Whether a short factual answer has unnecessary emotional emphasis.
- Whether longer sentences remain clear rather than becoming choppy.
- Whether pauses distinguish clauses without making the reply drag.

Pre-generated samples establish delivery and synthesis measurements. They do not establish the delay of a live conversation involving recognition and OpenCode.

The audition page should allow replaying the same original lines across candidates. A whole exchange is more informative than one greeting.

## What the completed audition actually established

The audition compared current MAI Harper, Harper with neutral style at 5% slower speed, British MAI Emily with neutral style, Kokoro `af_heart`, and Kokoro `bf_emma`. A fixed stand-in voice read the user lines. All conversation scripts were original examples, not episode recordings.

The implementation session preserved the scripts and measurements in [`audition-data/manifest.json`](audition-data/manifest.json), actual current-app replies in [`audition-data/current-app-capture.json`](audition-data/current-app-capture.json), and repeated Azure-control checks in [`audition-data/probe-results.json`](audition-data/probe-results.json) and [`audition-data/probe-repeat.json`](audition-data/probe-repeat.json). These are development evidence, not proof of TNG authenticity.

| Observation | What it establishes |
|---|---|
| MAI Flash took about 220 ms at the middle measurement and 260 ms at the slowest to produce the first sound. | Synthesis can start quickly for these prepared inputs. This excludes listening and model response time. |
| Kokoro on CPU took about 790-906 ms at the middle measurements, with some samples up to 1.8 seconds. | The tested local alternative works, but has a larger initial synthesis delay on this machine. |
| Real OpenCode/Copilot replies took 1.7-7.6 seconds to finish. The current app waits until completion before speaking. | Model completion and the app's playback rule can dominate the delay; changing the voice alone cannot solve it. |
| Azure accepted documented styles and changed the audio; a made-up style returned HTTP 400. | Style selection is supported and errors can be surfaced explicitly. Whether a style feels right still needs listening review. |
| Speaking rate changed a test sentence from 6.1-6.7 seconds at normal speed to 7.6-8.1 seconds at -20%, or 5.1-5.7 seconds at +20%. | Rate adjustment has a measurable effect. |
| A requested 1500 ms pause made no difference. Pitch was accepted but its effect was not confirmed. | Do not rely on pause tags or claim pitch control works merely because the request succeeds. |
| The non-Flash MAI model took 1.07 seconds to produce the first sound. | It was slower in this probe; this is not a general comparison of every voice or workload. |

The new scripts contained 123 words over ten computer turns and took 43-50 seconds to speak. Actual current-app wording contained 116 words over six turns and took 63 seconds. Because the content, turn counts, and delivery differ, these totals are not a controlled speed comparison. Fixed pauses on the audition page are not real response times.

The real app capture also confirmed functional problems: a list introduction was spoken without its listed answers; underscores disappeared from identifiers; raw timestamps and paths were read literally; and a request to show information did not produce a concise screen handover. These findings support objective fixes independently of a subjective voice choice.

## Listening review and conservative implementation

The user should judge both conversation wording and audible delivery. Record which option feels closest to the intended original tribute and what still feels wrong.

The user's listening judgment was: "the british computer voices are better." The resulting implementation direction is British MAI Emily with neutral style as the preferred voice, with British Kokoro `bf_emma` available as a local alternative. Other voices remain selectable, and explicitly saved voice choices should be preserved. This is a preference for British delivery, not a claim of TNG authenticity.

The demonstrated spoken-answer and clarification problems still require fixes; changing the voice cannot repair them.

Visible input restyling and voice-over-voice interruption remain excluded until a further explicit decision. Spoken clarification must use OpenCode's actual pending question and preserve choices and permission boundaries. Every implemented change needs real behavior checks, not merely convincing sample audio.

Do not describe the research as acoustically complete, or the app as faithful, solely because the speech connection passes its checks.


## What was implemented and checked

These changes follow the objective findings above. They do not settle whether the conversation feels like TNG; that remains the user's judgment.

| Finding | What Picard Code now does |
|---|---|
| Speech was cut from the first paragraph of a written answer. | Picard Code's always-supplied instructions ask for a complete spoken first paragraph of one to three sentences. Detail follows for the screen. If a reply still opens with a list, the list items are spoken; a lead-in ending in a colon becomes a full sentence with a pointer to the screen. |
| Identifiers, paths, timestamps and links were read literally or lost their meaning. | Speech only, never the screen: `src/config.ts:3` becomes "src slash config dot ts, line 3"; `MAX_RETRIES` becomes "max retries"; timestamps become dates; links become "the link on screen". The written reply keeps the exact text. |
| A question from OpenCode produced only a generic notice. | A single question is spoken with its offered choices, and listening resumes for the answer. A clear choice ("the second one", or the option's name) is sent through OpenCode's real question mechanism. A reply that contains a negation is never taken as a choice. If only offered answers are allowed, anything else is asked again. Several questions at once are shown on screen. |
| A refused action could end with no reply at all. | The computer says "Request denied. The action was not carried out." A failed action is reported as failed. |
| Short follow-ups, corrections and "show me" lacked guidance. | The instructions cover all three, plus specific reasons for unavailable information, truthful completion reports and no stock catchphrases. |
| Voice choice. | British MAI Emily (`en-GB-Emily:MAI-Voice-2.1-Flash`) with the neutral style is the default, following the user's listening preference. Kokoro defaults to the British `bf_emma`. Harper, `af_heart` and the other voices remain selectable. |

Not implemented, by decision: rewriting requests in a captain's style, and interrupting the computer by voice. Approvals always need a button press.

### Real multi-turn check

`npm run test:behavior:live` drives Picard Code's own local interface with OpenCode and GitHub Copilot, in a temporary project. On 31 October 2026, with `gpt-5.6-terra`, all 23 checks passed:

| Turn | User | What was spoken |
|---|---|---|
| Investigation | Which file sets the retry limit, and what is it? | src slash config dot ts sets the retry limit: max retries = 3. |
| Follow-up | And the service address? | The service address is the link on screen, set in src slash config dot ts as service URL. |
| Correction | No, I meant how many attempts the retry helper actually makes, not the setting. | The retry helper makes four total attempts: one initial attempt and up to three retries. |
| Show me | Show me. | The calculation is in src slash retry dot ts. The details are on screen. |
| Question | Ask me with your question tool whether the retry limit should be 3 or 5. Do not change any files. | The real question was asked aloud with its choices; the spoken choice was sent; no files were changed. |
| Refused approval | Run the command node --version and tell me the result. | Request denied. The action was not carried out. (The command did not run.) |

Replies finished 2.6 to 8.5 seconds after sending. That excludes listening and speaking time. Model wording varies from run to run; the check verifies behavior, not exact words.

Also passed on the same day: real MAI listening and Emily speaking, real local Whisper and Kokoro `bf_emma` on the CPU, and full browser conversations through both speech paths using a synthesized test microphone.

### Still unverified

- A physical microphone in a real room, including echo from loudspeakers.
- macOS and Linux.
- Whether the wording, voice and timing now feel right. This needs the user's listening review.