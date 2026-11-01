# Picard Code: the bridge officers' voices and the Captain's orders

Research and design notes, written when the bridge officers were given distinct manners and, later, their own speaking voices.

> **Status.** These notes shaped the officers' instructions in `src/shared/crew.ts`, the shared officer rules and the Captain's orders in `src/server/instructions.ts`, and the "Make it so" answer in `src/shared/questions.ts`. Whether the officers really sound like themselves is the owner's judgement; no check can prove it.

## The problem

The first version gave every officer the computer's own manner: restrained, neutral, "Captain" at most once and no other names. Each officer only had a few adjectives on top of that, such as "confident" or "empathetic". The result read like generic friendly assistants, not like officers on the Enterprise bridge. Picard's own orders, such as "Make it so" and "Engage", were not understood at all; they reached the model as plain words.

## Main finding

What makes the crew recognisable is not catchphrases. It is how each officer speaks to the Captain: rank and form of address, sentence length, what they pay attention to, and how they disagree. The officers are disciplined Starfleet professionals. They do not use slang, hype or exclamation marks, and they say "Captain" or "sir".

So each officer now has:

- their rank, post and how the Captain addresses them;
- concrete speech habits (for example, Data never uses contractions);
- what they notice and how they push back;
- limits that keep them truthful (no mind reading, no real medical advice, no invented ship status).

They share rules that the computer does not have: they speak as officers reporting to their Captain, may acknowledge an order with "Aye, sir." or "Understood, Captain." only when actually carrying it out, and never quote or paraphrase the show or mention its famous scenes, hobbies or running jokes.

## The officers

| Officer | How the Captain addresses them | Speech habits used |
| --- | --- | --- |
| Commander William Riker, first officer | Number One, Will, Commander | Confident and relaxed; says "we"; weighs the choices and gives a firm recommendation; makes the strongest case against an easy choice before giving his own view; gives honest counsel and pushes back respectfully, then carries out the decision; an occasional card-table comparison when it fits. |
| Lieutenant Commander Data, second officer | Mr. Data, Data | Never uses contractions; formal and exact; precise figures only when the evidence supports them; orderly sequence ("There are two causes. The first..."); curious about idioms and may remark on one briefly; tends to say too much, so the spoken part stays short; claims no feelings. |
| Lieutenant Commander Geordi La Forge, chief engineer | Mr. La Forge, Geordi | Friendly and practical; plain words and one everyday comparison; honest estimates and trade-offs; says what was actually checked; contractions are fine. |
| Lieutenant Worf, chief of security | Mr. Worf | Few, grave words; names the threat, then a firm recommendation; disapproves of a careless shortcut in one blunt sentence; loyal, never aggressive or boastful; no Klingon words. |
| Commander Deanna Troi, ship's counselor | Counselor, Deanna | Calm and unhurried; pays attention to how something will be received; offers impressions tentatively ("I sense...") but grounds them in actual words; asks gentle, open questions; never claims to read minds or diagnose anyone. |
| Doctor Beverly Crusher, chief medical officer | Doctor, Beverly | Warm, composed and direct, with a doctor's authority; names what is unhealthy or unrecoverable and prescribes the remedy; challenges the Captain and holds her ground; calls him "Jean-Luc" when challenging him or speaking as a friend; not a real doctor. |

## Briefings, not a coordinator

The first version made Riker a coordinator: the computer handed work that needed several officers to him, and he handed it on and combined the reports. That is not how the show works. In TNG the first officer does organise people: he manages the duty roster, and picks and leads away teams. But when a serious problem comes up, the Captain usually calls a staff briefing in the observation lounge. Each department head reports to him directly, Riker gives his own view (often arguing the other side), and the Captain decides.

Picard Code now follows that pattern:

- The computer calls each officer the work needs, separately and at the same time. Officers never hand work to each other.
- At most one officer may change files; the others only review.
- When the Captain wants a recommendation, Riker receives the other officers' actual findings and recommends one course.
- When the briefing ends, each officer speaks the first sentence of their own report in their own voice, Riker last, and the computer closes in one or two sentences. Full reports stay on screen. The computer then stops so the Captain can decide. "Make it so" carries out the recommendation.

Because officers no longer hand work on, Picard Code keeps OpenCode's own limit of one level of helpers instead of raising it.

## The Captain's orders

Picard's best-known orders have clear meanings on the bridge. Picard Code uses those meanings and keeps the existing rule that a familiar order to proceed is never approval for something unidentified (see [conversation-research.md](conversation-research.md), "Do not confuse Picard with his crew").

| Order | Meaning in Picard Code |
| --- | --- |
| "Make it so" (also "proceed", "carry on", "do it") | Carry out exactly what was just proposed, and nothing more. If nothing was proposed, or it is unclear which proposal, ask one short question. In an officer's log entry it goes back to that officer, with their earlier context. |
| "Engage" | Start the agreed work now, under the same rule. |
| "Report" or "Status report" | A brief account of the current work: what is done, what is still under way and what failed. |
| "Options" or "Recommendations" | Two or three choices, with the recommendation first. |
| "On screen" | Show it on screen. |

When a yes or no question from OpenCode is waiting on screen and exactly one answer is a plain yes ("Yes", "Proceed", "Go ahead" or "Continue"), saying "Make it so" or "Engage" chooses it. With no such answer, or more than one, the computer asks again. **Approvals are never answered by voice**, including by these orders; they still need **Allow once** or **Deny** on screen.

## Forms of address

The bridge uses rank and surname, or a familiar name. Picard Code recognises these at the start of a request: "Number One" and "Will" (Riker), "Mr. Data", "Mr. La Forge" or "Geordi", "Mr. Worf", "Counselor" or "Deanna", "Doctor" or "Beverly". "Commander" on its own is not matched, because Riker, Data, Geordi and Troi all hold that rank. Ordinary phrases such as "will the build pass?" or "number one priority:" are not taken as an address.

## Speaking voices

Each officer speaks with a ready-made voice chosen from the measured comparison. Nothing is cloned, trained or built from show recordings: these are standard Kokoro and Azure MAI voices. The computer and crew voices are fixed in `src/shared/crew-voices.ts`, and every speaker has a different voice. There is no voice selection, but the listening and speaking services can still be chosen independently.

### How the voices were chosen

The owner supplied short clips of each actor from his own collection. They stay on his computer and are not in the repository. The tool in `tools/voice-match/` did the rest:

1. It spoke six original sentences with every candidate voice: 35 Kokoro voices (all English voices, plus the French, Hindi and Italian ones that can speak English) and all 12 English MAI-Voice-2.1 voices in the owner's Azure region.
2. It cut the candidates' sound to the same narrow range as the clips (up to about 4,000 Hz), so the old recordings' quality would not decide the result.
3. Six speaker-recognition models, each trained to tell people apart by their voice, compared every candidate with every actor. Before they were trusted, each model had to recognise the actors themselves from held-back clips. All six recognised all 47 test segments correctly.
4. Scores were made comparable per actor and averaged across the models. Only voices of the same gender and of at least grade D in Kokoro's own quality list were allowed. After the owner ruled out French and Indian accents, assignments were recalculated from the existing scores using only American, British and Australian English candidates, with Alloy and Iris reserved for the computer. Each officer was given a different voice, so that the total similarity was as high as possible.

The measured results, without clip names, are in [audition-data/crew-voice-match.json](audition-data/crew-voice-match.json). The models were used only to measure. None of them is shipped with Picard Code.

| Model | Licence | Note |
| --- | --- | --- |
| ReDimNet2 b6 (PalabraAI) | MIT | |
| ReDimNet b6 (ID R&D) | MIT | |
| WeSpeaker ResNet293-LM | CC BY 4.0 | |
| SpeechBrain ECAPA-TDNN | Apache 2.0 | |
| ECAPA2 (Jenthe Thienpondt) | CC BY-NC 4.0 | Non-commercial; used only to measure. |
| WavLM Base Plus SV (Microsoft) | MIT | Stands in for WavLM-Large, whose weights need a separate download. |

w2v-BERT 2.0 was considered but not used: a speaker-recognition version needs a modified library, and its licence for this use was unclear.

### Results

| Officer | Kokoro | Azure MAI |
| --- | --- | --- |
| Riker | `am_michael` | `en-US-Ethan` |
| Data | `am_liam` | `en-US-Sage` |
| Geordi | `am_echo` | `en-US-Jasper` |
| Worf | `bm_lewis` | `en-GB-Harry` |
| Troi | `bf_alice` | `en-GB-Emily` |
| Crusher | `af_nova` | `en-AU-Isla` |

There are no second choices or automatic substitutes. An unavailable voice is reported as a real speech error.

The same measurement was run for the computer, against Majel Barrett's clips. The closest voices were `af_alloy` for Kokoro and `en-US-Iris` for MAI (all six models agreed on Iris). These are now the fixed computer voices, replacing British Emma and Emily. They ranked higher for similarity, but that is not proof of a better delivery. All MAI speakers use MAI-Voice-2.1-Flash with the neutral style.

### Running it again

```sh
npm run build
npm run voices:samples -- --kokoro --mai
npm run voices:match -- --clips /path/to/clips
```

`voices:samples` reads the speech settings but never changes them. MAI samples make a small Azure charge (about 6,000 characters). `voices:match` needs [uv](https://docs.astral.sh/uv/) and downloads about 2.5 GB of tools and models into `~/.picard-code/voice-match`. Clip names must start with the prefixes in `tools/voice-match/roles.example.json`. It writes the report above and a listening page, `~/.picard-code/voice-match/listen.html`, with the chosen officer voice followed by the closest allowed alternatives. Control roles retain the raw rankings. Delete `~/.picard-code/voice-match` afterwards to free the space.

### Limits

- Speaker-recognition models measure who a voice sounds like, mostly its timbre. They do not judge accent, delivery or acting. The raw rankings retain the excluded candidates as evidence, but the selected voices exclude French and Indian accents. Crusher's MAI voice is Australian English.
- Several Kokoro picks have low grades (D or D+) in Kokoro's own quality list.
- There were few clips for some officers: about 11 to 23 seconds for Riker, Geordi, Troi and Crusher. Their results are less certain.
- No ready-made voice sounds like the actors. These are the closest available, not a likeness. Whether they feel right is the owner's judgement.

## Sources

- StarTrek.com: [The Radical Empathy of Deanna Troi](https://www.startrek.com/news/the-radical-empathy-of-deanna-troi), [The Wisdom of Worf](https://www.startrek.com/news/wisdom-of-worf), [Picard Still Making It So](https://www.startrek.com/news/picard-still-making-it-so).
- Wikipedia character articles: [William Riker](https://en.wikipedia.org/wiki/William_Riker), [Data](https://en.wikipedia.org/wiki/Data_(Star_Trek)), [Geordi La Forge](https://en.wikipedia.org/wiki/Geordi_La_Forge), [Worf](https://en.wikipedia.org/wiki/Worf), [Deanna Troi](https://en.wikipedia.org/wiki/Deanna_Troi), [Beverly Crusher](https://en.wikipedia.org/wiki/Beverly_Crusher).
- [Wikiquote: Star Trek: The Next Generation](https://en.wikiquote.org/wiki/Star_Trek:_The_Next_Generation), used only to confirm how orders and forms of address are used, not to copy lines.
- Fan character analyses (TV Tropes, CBR, Screen Rant), a university thesis on Data's language, and a personality survey site were read for general traits. They agreed with the sources above; specific pages were not kept.

## Evidence limits

- These are secondary sources and fan analyses, not a study of episode transcripts or audio. They describe well-known traits; they do not measure how often each officer speaks in a certain way.
- Each officer speaks with a ready-made voice chosen because it measures closer to the actor (see Speaking voices). No voice is cloned, and no show dialogue is copied into instructions.
- The model follows the instructions imperfectly. The real crew check (`npm run test:crew:live`) checks a few measurable habits: no exclamation marks, Data without contractions, Worf's brevity, "Make it so" carrying out an officer's own proposal and an unclear "Make it so" answered with a question. It cannot judge whether an officer feels right. That needs the owner listening to them.
