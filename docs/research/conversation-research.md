# Picard Code: making the conversation feel like TNG

Research and design recommendations, 31 October 2026.

> **Status.** This is the research that shaped Picard Code's conversation rules. It is kept as written, with its evidence limits. Recommendations are not all implemented: the optional captain-style rendering of requests is **not** built. Spoken interruption is now implemented, but physical microphone and speaker echo still needs checking. See [voice-and-conversation-direction.md](voice-and-conversation-direction.md) for what was implemented and checked.

## Main finding

The convincing tribute is not a collection of stock phrases. It is the relationship between a person who gives purposeful instructions and a computer that understands the current context, supplies the requested information, asks for missing details, and respects limits.

Picard's side and the computer's side are different:

- **Picard:** purposeful questions and commands, increasingly short follow-ups when the context is established, occasional explicit parameters, and natural human reactions.
- **Computer:** factual answers, operational notices, focused clarification, and concrete explanations of unavailable functions.

For Picard Code, reproduce those interaction patterns using original wording. Do not make the user impersonate Picard, and do not make the computer impersonate a conversational crew member.

**Recommended approach:** use OpenCode's existing AI and custom instructions, not a separately trained model. Keep the user's original request authoritative. An optional Picard-style rendering can appear on screen without changing what the coding engine is allowed to do. Azure/MAI remains the preferred listening and speaking service; Whisper and Kokoro should use the same conversation rules.

## What the evidence can and cannot establish

The episode research reviewed exchanges attributed to Picard, Captain Picard, and Jean-Luc Picard. It distinguishes direct computer interaction from orders to officers, communication calls to the bridge, and dialogue with holodeck characters.

Most evidence below comes from Chakoteya's unofficial transcriptions of aired episodes. These are useful, but are not official studio transcripts and may contain errors. A production draft for *11001001* provides an independent comparison for that episode. A draft is not proof that every detail appeared in the final broadcast.

The sources establish dialogue structure, participants, and stated circumstances. They do **not** establish precise pitch, speaking rate, timing, vocal warmth, or the sound of interface cues. Those require listening to the actual performances. No claim in this report is a measured reconstruction of Majel Barrett-Roddenberry's delivery.

The official StarTrek.com article [The Sound of Their Voices](https://www.startrek.com/news/the-sound-of-their-voices) confirms her computer-voice role. It is a casting reference, not an analysis of the performance. The research did not inspect audio or identify a usable official clip for measuring Picard-computer timing.

These are selected examples, not a statistical survey of every episode. Words such as "always" and "never" would overstate the evidence.

## Episode evidence

The exchanges are summarized rather than reproduced. Scene labels are navigation aids from the transcript, not official scene numbers.

| Episode and source | Scene | What happens | Useful design lesson |
|---|---|---|---|
| [11001001](http://www.chakoteya.net/NextGen/116.htm) | Holodeck exit and arch | Picard requests the exit, uses the arch controls to contact the bridge, and then questions the computer about the alert. | Speech and panels coexist. A bridge call is not a computer command. |
| [11001001](http://www.chakoteya.net/NextGen/116.htm) | After the holodeck exit | A sequence moves through the alert's cause, present condition, crew location, and destination. Some answers are explicitly unavailable. | Follow-ups should inherit the subject instead of requiring the full request again. |
| [11001001](http://www.chakoteya.net/NextGen/116.htm) | Weapons-room access | Picard uses a short self-identification and access instruction rather than a full conversational introduction. | Repeating an address word before every action is not essential to the feel. This is fictional access handling, not a security design to copy. |
| [11001001](http://www.chakoteya.net/NextGen/116.htm) | Auto-destruct setup and cancellation | The computer checks concurrence before proceeding. The draft and aired transcription differ in the surrounding human dialogue. | Consequential commands are not automatically executed merely because a confident voice issues them. Copy the approval principle, not the fictional hierarchy. |
| [Where Silence Has Lease](http://www.chakoteya.net/NextGen/128.htm) | Engineering, auto-destruct setup | The computer asks for the desired interval; Picard pauses to consider it before supplying the value. | A clarification can remain open while the user thinks. A pause is not automatically a completed answer. |
| [Where Silence Has Lease](http://www.chakoteya.net/NextGen/128.htm) | Picard's quarters | Picard queries Data's location while testing an apparent encounter. The answer exposes the figure in his quarters as an illusion. | The computer provides a factual reference against a deceptive appearance. The transcript does not establish that Nagilum fabricated the computer's answer. |
| [Ship in a Bottle](http://www.chakoteya.net/NextGen/238.htm) | Holodeck and apparent bridge | Picard requests an exit and later investigates unavailable command functions and rejected authorization. The story involves a simulated Enterprise. | Use the shape of a specific refusal and follow-up explanation; do not treat simulated command handling as proof of the real ship's normal behavior. |
| [Ship in a Bottle](http://www.chakoteya.net/NextGen/238.htm) | Corridor, after the deception is identified | Picard orders the discontinuation of Moriarty's simulation; a subsequent working bridge communication helps establish the return to the real ship. | A real stop instruction is distinct from a simulated refusal. Report what actually ended, not merely what an apparent interface claimed. |
| [Lessons](http://www.chakoteya.net/NextGen/245.htm) | Ready room | Picard requests excavation schematics. The library is unavailable because its systems have been assigned to Stellar Cartography. | Give the specific reason a function is unavailable rather than a decorative error phrase. |
| [Lessons](http://www.chakoteya.net/NextGen/245.htm) | Picard's quarters | A replicator request is also blocked by the same resource allocation. The transcript presents Picard anticipating the explanation. | The person remembers the interaction too. Repeating the entire explanation can be unnecessary; the exact comic timing needs audiovisual verification. |
| [Lessons](http://www.chakoteya.net/NextGen/245.htm) | Music playback in quarters | Picard pauses playback while also responding to a visitor. | Not every nearby utterance is intended for the computer. Routing and microphone behavior matter. |
| [Conundrum](http://www.chakoteya.net/NextGen/214.htm) | Bridge, following the memory loss | Picard requests a status report; another officer identifies that the voice interface is unavailable. | Failure of the voice channel needs an unmistakable visible fallback, not endless listening or silence that looks like success. |
| [Chain of Command, Part I](http://www.chakoteya.net/NextGen/236.htm) | Holodeck training | Picard freezes the training program, then addresses the trainees. | Distinguish the computer instruction from surrounding conversation. |
| [Chain of Command, Part I](http://www.chakoteya.net/NextGen/236.htm) | Transfer of command | Picard performs an explicit command transfer and the computer reports the completed change. | A confirmation describes an actual state change. Fictional voice codes should not replace real account authentication. |
| [The Defector](http://www.chakoteya.net/NextGen/158.htm) | Bridge and ready room, secured message | The computer announces an incoming priority message. Picard asks about its delay and supplies instructions to access it. | The computer can speak first when a meaningful event warrants attention. Follow-ups can concern the current event without reintroducing it. |

### Important contrast: Riker, not Picard

In *11001001*, Riker asks for a musical setting. The computer obtains the missing genre, period, and place through short follow-up questions.

This is valuable evidence for the **computer's** conversational ability, but not evidence that Picard uses precisely the same requesting style. It suggests asking for only the missing detail, not presenting a form or demanding that the user repeat the whole request.

### Important contrast: a computer inside a simulation

In *Ship in a Bottle*, the apparent bridge's authorization refusals occur inside Moriarty's simulation. They are dialogue written to sound plausible, not verified normal behavior of the real ship computer.

In *Where Silence Has Lease*, Nagilum creates deceptive surroundings and figures, but Picard uses the computer's location answer to expose an illusion. The reviewed transcript does not give grounds to call that answer fabricated.

Those are different relationships to uncertainty. For Picard Code, verified tool results should be the reference for what happened; the assistant's narrative must not override them.

The fan transcripts also contain very similar auto-destruct cancellation dialogue in both *11001001* and *Where Silence Has Lease*. That does not establish whether the similarity reflects the performances, a deliberate callback, or transcription issues. This report does not infer a production explanation from it.

### Examples not suitable as positive evidence

Earlier searches suggested direct Picard-computer exchanges in *Clues*, *Time Squared*, and *Allegiance* that the reviewed sources did not substantiate. Those claims are excluded.

Several additional transcripts were only partly reviewed. A search that finds no exchange in part of an episode does not establish that the episode contains none. This report makes no exhaustive absence claims about *Cause and Effect*, *Family*, *Sarek*, *Timescape*, or *Masks*.

### Later user observation: an acknowledgment sound

After watching a fan-uploaded clip titled [Star Trek - Computer, make this a metal table](https://www.youtube.com/watch?v=lPLiaYD1lUo) (uploaded by markipark, not an official source), the user observed: "metal table. it makes a sound when it acknowledges the command."

Record this as a **user-observed** acknowledgment sound in that one clip. The researchers did not listen to it themselves, and it is not evidence of a rule across TNG. It does correct the earlier statement that no scene-level evidence about acknowledgment sounds had been found.

Picard Code does not add any sound because of this observation alone.

**Later decision.** After hearing TrekCore's recordings and having redistribution
rights explained, the user confirmed permission and chose four short sounds:
Computer Work Beep (request accepted), processing3 (work still running),
input_failed_clean (speech not understood or not sent) and denybeep1 (accepted
request failed or denied). They are an optional download that is not stored
in the repository; see `THIRD_PARTY_NOTICES.md`. No one involved claims they
are the exact effect from the clip above.

## What Picard's requesting style actually contributes

### 1. Purpose before conversational padding

The useful pattern is an address, an action or question, an object, and any needed limits. This is a design description, not a rigid grammar:

> Computer, investigate the failed release checks. Make no changes.

This original example carries both the objective and the boundary. Shortening it to a bare command that drops the boundary would be less faithful to a precise captain, not more.

Users should not have to learn special vocabulary. Everyday language remains valid.

### 2. Context makes short follow-ups possible

Once an investigation is established, the user should be able to ask:

> Which file?  
> What changed?  
> Show the earlier result.

The application must preserve enough context to know what those questions refer to. Where there are several plausible subjects, a brief clarification is better than an arbitrary guess.

A collection of isolated voice commands will not achieve this, regardless of voice quality.

### 3. Human speech should stay human

The reviewed exchanges contain questions, asides, reactions, and instructions to people alongside instructions to the computer. They do not justify stripping every utterance into a clipped imperative.

The app should not scold users for politeness, hesitation, or incomplete phrasing. It also should not mistake a hypothetical discussion for an action request.

### 4. Do not confuse Picard with his crew

Picard's instructions to Data or other officers are not direct computer exchanges. A coding assistant may perform substantial investigation, but that does not require simulated officers, ranks, or catchphrases addressed to fictional crew.

Similarly, a familiar order to proceed is not automatically approval for an unidentified action. If several operations are pending, the computer needs to ask which one.

## What the computer's answering style contributes

### Bounded answers

Answer the question that was asked. If the user asks whether a build passed, lead with its result. Do not read the entire build log.

Keep detailed evidence available on the display. Brief speech and thorough visible information are complementary.

### Focused clarification

Ask the missing question, not a questionnaire. For example:

> Which project?

If there is only one clearly selected project, asking again creates friction rather than realism.

### Specific limits

There are different reasons the computer might not produce an answer:

- The cause has not been established.
- The requested file or record does not exist.
- The user has not granted access.
- A service is unavailable.
- The microphone or speech service failed.

Use the real distinction and include the useful next step. Do not replace it with the same vague thematic refusal each time.

### State changes, not performance

Only announce completion after a real result. A spoken acknowledgment must not imply that an action has already occurred.

A quiet visual indication can be enough while a task begins. A short progress report is useful when work takes time, but should not be mechanically repeated before every reply.

### Selective unsolicited speech

The computer can announce an important completed task or a blocker requiring attention. It should not narrate every background operation or interrupt the user with minor events.

### Delivery: an original interpretation

For the first voice audition, use clear articulation, restrained expression, natural sentence rhythm, and little conversational padding. Do not assume "computer-like" means cold, flat, or dramatically slow.

That is a proposed original direction, not a verified acoustic reconstruction. We still need listening comparisons to judge whether Kokoro and MAI convey it well.

## Could the app translate our requests into Picard's style?

**Yes, as wording rather than voice imitation.** OpenCode supports custom assistant instructions and custom prompts. It also documents structured responses, which could support a separate field containing the display rendering. No special model training is necessary to try this.

Sources: [OpenCode assistants](https://opencode.ai/docs/agents/), [instructions](https://opencode.ai/docs/rules/), and [SDK, including structured output](https://opencode.ai/docs/sdk/).

The best initial design is:

1. Recognize the user's speech.
2. Retain that original recognized request as the request the coding engine receives.
3. Optionally show a concise captain-style rendering alongside it.
4. Let OpenCode answer with the computer-style instructions.
5. Speak the short, truthful result and display the detailed result.

The display rendering is not a new authorization. It cannot replace the original request, silently resolve ambiguity, or widen permission.

Also distinguish **what the user really said** from **what speech recognition produced**. Keeping the transcript unchanged protects against rewriting errors, not transcription errors. An uncertain filename or risky instruction may still require a focused confirmation.

### Why not silently replace every request?

Fluent rewriting does not guarantee unchanged meaning. The primary paper [Say It Another Way](https://arxiv.org/html/2505.03563v2), particularly sections 5.1-5.3, reports meaning-preservation problems in generated paraphrases and limitations of automatic filtering.

That study examines language-model evaluations, not this application or spoken coding commands. It supports caution about rewriting; it does not provide a measured error rate for Picard Code.

An additional rewriting call can also add delay and cost. Start with the existing model and instruction system. A separate, specially trained model should be considered only if measured failures or cost justify it.

### Original examples: normal request to captain-style rendering

These are proposed transformations, not quotations from TNG or outputs from a tested model.

| Normal request | Possible rendering | What must stay unchanged |
|---|---|---|
| Can you explain how login works here? | Computer, explain this project's login process. | Explanation only; not a request to change it. |
| Check why the login tests fail. Don't edit anything. | Computer, investigate the failing login tests. Make no changes. | The explicit no-edit limit. |
| What changed since yesterday? | Computer, compare the changes since yesterday. | The time boundary, including ambiguity about local time. |
| Show me the file you just mentioned. | Computer, display that file. | The contextual reference. Ask if several files were mentioned. |
| Could we deploy this to production? | Computer, assess whether this can be deployed to production. | A feasibility question, not permission to deploy. |
| Rename `userId` to `accountId` in this file only. | Computer, rename `userId` to `accountId` in this file only. | Exact identifiers and file scope. |
| Stop talking, but keep the tests running. | Computer, stop speaking. Leave the tests running. | Stop playback, not the task. |
| Actually, use the other branch, but don't switch yet. | Computer, revise the branch selection. Do not switch yet. | Correction, uncertainty about which branch, and no-switch limit. |

### Original examples: computer-style responses

The factual claims below are conditional examples. The app must derive the values from actual results.

| Situation | Possible spoken response |
|---|---|
| The tests passed | All twelve tests passed. |
| Investigation found a cause | The login check uses an expired token. The affected line is on screen. |
| Cause not yet established | The cause is not established. I can inspect the earlier logs. |
| An identifier was not understood | Which identifier should be renamed? |
| A service cannot be reached | The speech service is unavailable. Check the connection or use typing. |
| A consequential action is pending | This will publish the current branch. Approve publication? |
| Displaying substantial code | The changes are on screen. |
| A long-running task completes | The build has finished. One check failed. |

Do not play back a rewritten version of every user request before answering. Two consecutive voices reciting the same instruction would make ordinary conversation feel slower. The rendering can remain a visible optional feature.

## Implementation rules worth testing

These are recommended acceptance checks, not claims that the current build already passes.

| Check | Required behavior |
|---|---|
| Negation | Never drop a prohibition such as no edits, no publication, or no branch switch. |
| Exact technical text | Preserve identifiers, paths, quoted strings, numbers, and command flags exactly in the request. |
| Questions versus orders | A feasibility question must not become an executable approval. |
| Conditions | Preserve dependencies such as only after review or only if tests pass. |
| Scope | Never expand one file to the project, one branch to all branches, or a test environment to production. |
| Corrections | Carry the latest correction into the context; do not execute the previous intent after it has changed. |
| Ambiguity | Ask a focused question where a wrong interpretation could affect the result. |
| Follow-ups | Resolve short questions against the active discussion without requiring repeated full instructions. |
| Completion | Every spoken completion claim must agree with a verified operation result. |
| Interruption | Stopping speech must not silently cancel work; cancelling work must stop the intended operation and report its real state. |
| Self-listening | The app must not submit its own spoken responses as new user requests. |
| Ordinary conversation | No routine transcript review, Send button, or repeated push-to-talk step after microphone activation. |
| Approval | Approval applies to the specified pending action, not a different action introduced by a stylistic rewrite. |
| Service switching | The same checks apply with MAI and with Whisper plus Kokoro; local mode is not an excuse to change the interaction. |

For performance, measure the time from the user's actual end of speech to the first relevant response, and the time from an interruption to playback stopping. A startup chime or stock acknowledgment should not count as a completed response. Measure simple questions separately from real coding investigations.

Azure's [phrase-list documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/improve-accuracy-phrase-list) describes recognition hints for names and domain terms. They can help with project vocabulary, but do not guarantee correct recognition and do not prove intended authorization.

## Recommendation for the first version

Keep the coding engine and speech services already chosen. Improve the interaction instructions and test representative conversations before considering any additional model.

Make the computer's speaking style part of the normal assistant instructions. Prototype the captain-style display rendering as an optional, non-authoritative view; evaluate it against exact meaning-preservation cases before using it more widely.

The tribute should be recognizable through context-aware conversation, purposeful speech, useful displays, and truthful limits. It should not depend on copying an actor's voice, reproducing scripts, or adding fictional authority to real actions.

## Source index

- [11001001: aired-episode fan transcript](http://www.chakoteya.net/NextGen/116.htm)
- [11001001: production draft, 19 November 1987](https://tng.trekcore.com/episodes/scripts/116.txt)
- [Where Silence Has Lease: fan transcript](http://www.chakoteya.net/NextGen/128.htm)
- [Ship in a Bottle: fan transcript](http://www.chakoteya.net/NextGen/238.htm)
- [Lessons: fan transcript](http://www.chakoteya.net/NextGen/245.htm)
- [Conundrum: fan transcript](http://www.chakoteya.net/NextGen/214.htm)
- [Chain of Command, Part I: fan transcript](http://www.chakoteya.net/NextGen/236.htm)
- [The Defector: fan transcript](http://www.chakoteya.net/NextGen/158.htm)
- [StarTrek.com: The Sound of Their Voices, official casting reference](https://www.startrek.com/news/the-sound-of-their-voices)
- [OpenCode custom assistants](https://opencode.ai/docs/agents/)
- [OpenCode custom instructions](https://opencode.ai/docs/rules/)
- [OpenCode SDK and structured output](https://opencode.ai/docs/sdk/)
- [Say It Another Way: paraphrase evaluation paper](https://arxiv.org/html/2505.03563v2)
- [Azure recognition phrase lists](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/improve-accuracy-phrase-list)
