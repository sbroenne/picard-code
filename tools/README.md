# Record the actual app

The intro uses a real Picard Code browser, real local listening and speaking,
and a real OpenCode model. It does not inject replies or manufacture check
results. The Captain's original prepared lines use the stock Kokoro Daniel
voice through the browser microphone path. This is not a physical microphone
recording or an imitation of an actor.

You need ffmpeg and the installed Playwright browser.
First prepare local Nemotron, Smart Turn and Kokoro using the normal setup.
Do not change the owner's saved choices to make a recording. Build the app
and check the current models before selecting one:

```sh
npm run build
npm run opencode -- models
node --test tools/record-intro.test.mjs
node tools/record-intro.mjs --model github-copilot/gpt-6.1-sol
```

The recording creates a fresh original release-board project and separate
settings under the ignored `video/out/real-intro-*` folder. The example
deliberately starts with a misleading launch decision: one passing check
allows launch even when checkout fails. Its checks live in `checks.mjs`,
not an automatically discovered test file. Data reads without editing;
Geordi repairs and tests. Actual browser frames carry recording timestamps,
and a browser audio recorder captures the actual speaking output and the
prepared requests. Computer sounds are not supplied for this recording.
All owned services close afterward. Do not use this tool on a private project.

The run fails rather than declaring success if the requested words are lost,
the untouched-file check fails, the repair does not pass the original checks,
the browser does not show the corrected result, or real speech reports an
error. It does not answer OpenCode permission requests or questions for the
owner; those can prevent a recording from completing.

Use the folder printed by the recorder:

```sh
node tools/render-intro.mjs video/out/real-intro-EXAMPLE
```

That makes the full-report edit, with the actual before and after, spoken
orders and replies, two clearly marked shortened waits, and short original
opening and closing narration. The source supports a shorter Data excerpt
with `--data-end SECONDS`; measure a silent sentence boundary in that
recording first. The first paragraph becomes its caption text. Do not reuse
an earlier run's timing or cut away an important warning.

The folder holds the plain MP4, a 1280-by-720 thumbnail, SRT, top-positioned
VTT, proposed YouTube wording, `edit.json`, and `captioned.html`. From that folder, make the
top-caption version with:

```sh
npx hyperframes@0.8.226 render --composition captioned.html --output picard-code-real-intro-captioned.mp4 --fps 24 --workers 2 --no-best-effort
```

Review the whole recording, words, cuts, and caption alignment before
publication. Within-clip caption times are estimates, not forced alignment.
Keep all generated footage, audio, raw transcripts and local settings out of
git. Only share the chosen deliverables, not the raw settings or launch URL.
Publishing on YouTube still needs the owner's explicit approval.

## Voice matching

The tools in [`voice-match/`](voice-match/) helped choose the fixed speaking
voices for the computer and six bridge officers. They compare ready-made
Kokoro and Azure MAI voices with reference clips.
**They do not clone voices, train models, or turn the recordings into new speech.**

The reference clips stay on the owner's computer. No recordings, transcripts,
or clip names are included in the saved comparison report. The tools are for
development; they are not shipped in the npm package or run by the app.

## How we chose the voices

### 1. Make comparable samples

[`candidates.mjs`](voice-match/candidates.mjs) lists the candidates and six
original sentences, covering ordinary reports, problems, and recommendations.
Every candidate reads the same text through Picard Code's own speaking code,
using [`render-samples.mjs`](voice-match/render-samples.mjs).

The original comparison covered 35 Kokoro voices and 12 English Azure
MAI voices. That wider Kokoro set included French, Hindi, and Italian voices
that can read English. Those candidates remain in the measured evidence, but
they are not eligible for the officers' final voices.

### 2. Reduce differences caused by recording quality

[`match.py`](voice-match/match.py) loads audio as mono at 16,000 samples per
second, removes quiet sections, and adjusts the volume. It estimates the
reference clips' frequency range and limits the candidate samples to match:
about 3,973 Hz in the saved run. It also adjusts the candidates' overall
frequency balance towards the reference recordings.

This reduces the advantage of clean modern generated speech over older
recordings. It does not remove every difference caused by microphones,
background sounds, or recording conditions.

The tool joins short reference clips into roughly eight-second pieces and
splits candidate speech into pieces for comparison. Very short clips and
some trailing audio are left out.

### 3. Check the measuring models

Six speaker-recognition models turn each piece of speech into a set of
numbers describing the voice:

| Model | License |
| --- | --- |
| ReDimNet2 b6 | MIT |
| ReDimNet b6 | MIT |
| WeSpeaker ResNet293-LM | CC BY 4.0 |
| SpeechBrain ECAPA-TDNN | Apache 2.0 |
| ECAPA2 | CC BY-NC 4.0, non-commercial |
| WavLM Base Plus SV | MIT |

WavLM Base Plus SV was used instead of WavLM-Large. Model sources and
attribution are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
Check their terms before reusing them; using a model only for measurement
does not remove its license restrictions.

Before using a model's scores, the tool checks whether it can tell the
reference speakers apart. It holds out one piece, compares it with the
remaining pieces, and checks whether its own speaker is the closest match.
Only roles with at least two pieces take part in this check. A model must
score at least 60% to be used. Loading or measurement failures are printed
and recorded; the comparison can continue with the remaining models.

In the saved run, all six models identified all 47 eligible held-out pieces
correctly. This checks separation within those recordings, not whether a
generated voice sounds convincing to a listener.

### 4. Rank and assign the voices

For each model, the tool averages each speaker's measurements and compares
each candidate with each reference speaker. It puts the scores on a
comparable scale separately for each reference speaker, then averages them
across the models that passed the check.

It keeps the six highest-scoring candidates per role and speaking service,
after filtering for the same gender and, for Kokoro, a published quality
grade of at least D. From those shortlists, it chooses a different voice for
each officer, maximizing the combined score. An officer therefore may not
get their individual first choice.

The final officer assignments allow only American, British, or Australian
English voices. Kokoro Alloy and MAI Iris are reserved for the computer.
If there are not enough distinct eligible voices, assignment fails rather
than silently relaxing these limits.

The computer, Picard, and Q are comparison roles, not officer assignments.
The computer's Alloy and Iris choices were taken from its rankings; all six
models ranked Iris first for the computer. Picard and Q do not acquire
speaking voices in the app through this process.

## Results and their limits

The saved [comparison report](../docs/research/audition-data/crew-voice-match.json)
contains the model checks, scores, rankings, assignments, and pitch and pace
measurements. Pitch and pace are reported for context; they do not decide
the assignments. Scores are relative comparisons, not percentages of
likeness. The `agreement` count records how many models ranked a candidate
first within its service, before the final assignment restrictions.

The [bridge crew research notes](../docs/research/bridge-crew-voices.md#results)
list the chosen voices. The app's fixed choices live in
[`src/shared/crew-voices.ts`](../src/shared/crew-voices.ts). Running the
comparison does not change those choices or the owner's speech settings.

These are the closest eligible voices in the measured set, not replicas of
the actors. The models do not judge acting, accent, warmth, or clear
delivery. Some officers had only 11 to 23 seconds of reference speech, and
some chosen Kokoro voices have quality grades of D or D+. Listening remains
necessary; higher similarity alone does not prove a better speaking voice.

## Run the comparison again

Start from the repository root with the development dependencies installed
as described in [Run from source](../README.md#run-from-source).
You also need:

- [uv](https://docs.astral.sh/uv/) available in the terminal. The matching
  wrapper requests Python 3.12 and keeps its environment and model caches
  under `~/.picard-code/voice-match`.
- Local Kokoro speech already set up to render Kokoro samples.
- Your own Azure speech resource and saved settings to render MAI samples.
  MAI rendering sends only the original sample sentences to Azure and incurs
  charges. Reference clips are measured locally, not uploaded.
- Reference clips you are entitled to use, kept outside the repository.
  Do not commit or share other people's recordings without permission.

Use the filename prefixes in
[`roles.example.json`](voice-match/roles.example.json), or supply your own
roles file with `--roles`. Clips must be directly inside the chosen folder;
the tool does not search subfolders. Supported extensions are `.mp3`, `.wav`,
`.flac`, `.ogg`, and `.m4a`; decoding support depends on the local setup.

```sh
npm run build
npm run voices:samples -- --kokoro --mai
npm run voices:match -- --clips "/path/to/reference-clips"
```

In PowerShell, use `npm.cmd` for commands with `--` arguments.
To compare just one service, render it with only `--kokoro` or `--mai` and
use a samples folder containing only that service. Matching reads every
available service folder, regardless of which one was rendered most recently.

Generated samples are saved in `~/.picard-code/voice-match/samples/`.
Existing sample files are reused, so changed sentences or speaking settings
need a fresh output folder to avoid comparing stale audio. Rendering supports
`--output`, and matching supports `--samples`.

The default matching command **overwrites the repository's comparison report**.
For an exploratory run, keep the output outside the repository:

```sh
npm run voices:match -- --clips "/path/to/reference-clips" --report "$HOME/.picard-code/voice-match/comparison.json"
```

The listening page is `~/.picard-code/voice-match/listen.html`. Open it locally
to hear the assigned officer voice first, followed by allowed alternatives.
Comparison roles show their raw rankings. Its audio links expect a sibling
`samples/` folder; keep that layout if you use custom paths.

The first matching run downloads roughly 2.5 GB of packages and models.
Rendering and matching can take time. MAI rendering prints the pending
character count and refuses work above `--max-characters` (60,000 by default);
it reuses existing samples without another request. Inspect the report's
`models` section to see which models actually contributed before relying on
a new result. Do not commit local audio, downloaded models, or settings.
