# Picard Code: the bridge officers' voices and the Captain's orders

Research and design notes, written when the bridge officers were given distinct manners and, later, their own speaking voices.

> **Status.** These notes shaped the officers' instructions in `src/shared/crew.ts`, the shared officer rules and the Captain's orders in `src/server/instructions.ts`, and the "Make it so" answer in `src/shared/questions.ts`. Whether the officers really sound like themselves is the owner's judgement; no check can prove it.

## The problem

The first version gave every officer the computer's own manner: restrained, neutral, "Captain" at most once and no other names. Each officer only had a few adjectives on top of that, such as "confident" or "empathetic". The result read like generic friendly assistants, not like officers on the Enterprise bridge. Picard's own orders, such as "Make it so" and "Engage", were not understood at all; they reached the model as plain words.

## Main finding

What makes the crew recognisable is not catchphrases. It is how each officer speaks to the Captain: rank and form of address, sentence length, what they pay attention to, and how they disagree. The officers are disciplined Starfleet professionals. They avoid slang, hype and habitual exclamation marks, and they say "Captain" or "sir".

So each officer now has:

- their rank, post and how the Captain addresses them;
- concrete speech habits (for example, Data never uses contractions);
- what they notice and how they push back;
- limits that keep them truthful (no mind reading, no real medical advice, no invented ship status).

They share rules that the computer does not have: they speak as officers reporting to their Captain and may acknowledge an order with "Aye, sir." or "Understood, Captain." only when actually carrying it out. They do not copy show dialogue or mention famous scenes. Known character details can inform a relevant answer, but do not belong as unrelated asides.

The profiles also give each officer short, newly written examples in different situations. They show how that officer might explain uncertainty, give advice or challenge a decision, without turning the examples into lines to repeat. The examples reach both a directly addressed officer and an officer called for a briefing. Their opening paragraphs are complete enough to be spoken on their own.

The officers can use known details of their backgrounds and relationships when relevant, such as a question to Data about his cat or to Worf about Klingon culture. They should say when a detail is uncertain and leave unrelated character trivia out of work answers. The profiles do not copy scripts or add a new web lookup to the app.

## The officers

| Officer | How the Captain addresses them | Speech habits used |
| --- | --- | --- |
| Commander William Riker, first officer | Number One, Will, Commander | Confident and relaxed; speaks as a trusted colleague as well as an officer; weighs choices and gives a firm recommendation when one is needed; pushes back respectfully without turning every answer into a recommendation. |
| Lieutenant Commander Data, second officer | Mr. Data, Data | Never uses contractions; formal and exact without sounding like a list of definitions; separates known facts from possibilities; curious about human habits without repeatedly announcing that he is an android. |
| Lieutenant Commander Geordi La Forge, chief engineer | Mr. La Forge, Geordi | Friendly and practical; works through the next useful check with the Captain; distinguishes symptoms from causes and says what was actually checked; natural contractions are fine. |
| Lieutenant Worf, chief of security | Mr. Worf | Few, direct words; identifies the actual risk and a firm precaution; loyal and serious, with occasional dry humour; does not invent threats or force Klingon terms into unrelated answers. |
| Commander Deanna Troi, ship's counselor | Counselor, Deanna | Calm and unhurried; considers how people may receive something and gives a useful suggestion; treats unknown feelings as possibilities, never as facts or mind reading. |
| Doctor Beverly Crusher, chief medical officer | Doctor, Beverly | Warm, composed and direct; explains a concern and what would help; challenges the Captain about wellbeing, ethics and recovery; calls him "Jean-Luc" when challenging him or speaking as a friend; not a real doctor. |

## Captain-led briefings and delegated coordination

The earlier design made Riker a coordinator for every multi-officer request. A later version went too far the other way: it forbade him to coordinate and always made him speak last with a question. Neither is a general rule of TNG.

The episode summaries give more specific evidence:

- In [Tin Man](https://memory-alpha.fandom.com/wiki/Tin_Man_(episode)), Picard directs Riker to assemble the bridge staff. Officers and the mission specialist present the situation, and Picard gives direction.
- In [Cause and Effect](https://memory-alpha.fandom.com/wiki/Cause_And_Effect_(episode)), Picard asks for solutions, Riker and Data offer competing manoeuvres, and Picard chooses. Riker is not a compulsory closing speaker.
- In [Pen Pals](https://memory-alpha.fandom.com/wiki/Pen_Pals_(episode)), officers debate intervention and challenge one another; Picard hears their arguments and decides. Riker also organises the investigation team.

These are secondary summaries, not a complete survey of scripts. They support Captain-led discussion and delegation when needed, not a fixed speaking order or an absolute ban on Riker organising work.

Picard Code uses that pattern:

- An explicit officer address or address list goes directly to those officers without another model-based choice. Other briefings remain deliberate: the Captain asks for options, a recommendation or a briefing that needs several areas of expertise.
- The computer connects requested officers; it does not chair the discussion or decide for the Captain. Officers report directly, may disagree and can consider one another's actual findings when the request needs it. There is no compulsory Riker closing round or question.
- Only an explicit order to Number One to organise or coordinate work allows him to call other officers. Requests for his opinion or recommendation alone do not. Other officers name additional expertise needed rather than handing work on.
- At most one officer may change files, and only when changes were requested. The Captain's exact words, limits, selected model and existing approvals stay unchanged.
- Each officer's complete conversational answer is spoken in report order, including later paragraphs. Technical appendices belong under an On screen heading; code and tables are not spoken. Routine computer receipts stay on screen; real failures are still spoken. Riker's own answer follows the officers he called when he was explicitly asked to coordinate.

OpenCode's existing helper limit is unchanged. Riker can call officers from the main log entry, but cannot bypass that limit from an officer's child entry. Whether a model actually makes the requested tool calls remains something the real checks must verify, not something these instructions prove.

## The Captain's orders

Picard's best-known orders have clear meanings on the bridge. Picard Code uses those meanings and keeps the existing rule that a familiar order to proceed is never approval for something unidentified (see [conversation-research.md](conversation-research.md), "Do not confuse Picard with his crew").

| Order | Meaning in Picard Code |
| --- | --- |
| "Make it so" (also "proceed", "carry on", "do it") | Carry out exactly what was just proposed, and nothing more. A draft can use placeholders for missing names, dates or places instead of inventing them. If the task or its limits are unclear, ask briefly what to carry out. In an officer's log entry it goes back to that officer, with their earlier context. |
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

See the [tools README](../../tools/README.md) for the full measurement method,
requirements, output files, and limits.

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
- StarTrek.com character perspectives: [I Am Not A Robot](https://www.startrek.com/news/i-am-not-a-robot), [Geordi & Data's Greatest Adventures](https://www.startrek.com/news/geordi-datas-greatest-adventures), [5 Times Geordi La Forge Embodied Star Trek's Hopeful Future](https://www.startrek.com/news/five-times-geordi-la-forge-embodied-star-treks-hopeful-future), [The Best Picard and Riker Moments, Ranked](https://www.startrek.com/news/the-best-picard-and-riker-moments-ranked), and [Dr. Beverly Crusher's Guide to Saving the Enterprise](https://www.startrek.com/news/dr-crushers-guide-to-saving-the-enterprise).
- Wikipedia character articles: [William Riker](https://en.wikipedia.org/wiki/William_Riker), [Data](https://en.wikipedia.org/wiki/Data_(Star_Trek)), [Geordi La Forge](https://en.wikipedia.org/wiki/Geordi_La_Forge), [Worf](https://en.wikipedia.org/wiki/Worf), [Deanna Troi](https://en.wikipedia.org/wiki/Deanna_Troi), [Beverly Crusher](https://en.wikipedia.org/wiki/Beverly_Crusher).
- [Wikiquote: Star Trek: The Next Generation](https://en.wikiquote.org/wiki/Star_Trek:_The_Next_Generation), used only to confirm how orders and forms of address are used, not to copy lines.
- Fan character analyses (TV Tropes, CBR, Screen Rant), a university thesis on Data's language, and a personality survey site were read for general traits. They agreed with the sources above; specific pages were not kept.

## Evidence limits

- These are secondary sources and fan analyses, not a study of episode transcripts or audio. They describe well-known traits; they do not measure how often each officer speaks in a certain way.
- Each officer speaks with a ready-made voice chosen because it measures closer to the actor (see Speaking voices). No voice is cloned, and no show dialogue is copied into instructions.
- The model follows the instructions imperfectly. The real crew check (`npm run test:crew:live`) checks a few measurable habits: no exclamation marks, Data without contractions, Worf's brevity, "Make it so" carrying out an officer's own proposal and an unclear "Make it so" answered with a request for clarification. Add `-- --show-replies` to inspect its six original responses. The examples and checks do not prove that the model will always sound right; that needs the owner listening to it.
- In checks using a sample Project, GPT-5.3 Codex sometimes declined to call the requested officers and once invented a time in a draft. Claude Haiku 4.5 called the officers but made unsupported findings about the sample file. Results vary by model; check important reports rather than assuming they are correct.
- With the Captain-led instructions, Claude Sonnet 5.5 completed the real crew check, including explicit coordination by Riker and bans on officer calls. GPT-5.3 Codex also completed Riker's explicit two-officer coordination and respected the ban, but still refused the six-officer briefing by incorrectly treating the ban on shell commands as a ban on reads and officer calls. Recognising an explicit address list without another model choice does not make the later tool calls deterministic.
- With complete conversational speech enabled, GPT-6.1 Sol completed the real crew check, including the six-officer briefing and Riker's explicit coordination. The real behavior check also verified that all three conversational paragraphs were spoken while the technical appendix stayed on screen. The local browser conversation passed with Nemotron and Kokoro using generated microphone audio; a physical microphone and Azure speech were not checked in that run. These results do not prove that every later request will succeed.
