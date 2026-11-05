# Record the actual app

The YouTube intro is a short TNG episode: a tribute to Sir Patrick Stewart
and Captain Jean-Luc Picard, built around a real recording of Picard Code at
work. The app footage uses a real browser, real local listening and speaking,
and a real OpenCode model. Nothing is injected: replies, crew reports, file
changes and check results are what actually happened. The Captain's prepared
orders use the stock Kokoro Daniel voice through the browser microphone path.
This is not an imitation of an actor.

You need ffmpeg, the installed Playwright browser and working sound output on
the computer (the browser records the app's real audio). First prepare local
Nemotron, Smart Turn and Kokoro using the normal setup. Do not change the
owner's saved choices to make a recording. Check the current models before
choosing one:

```sh
npm run build
npm run opencode -- models
node --test tools/record-intro.test.mjs video/edit.test.mjs
node tools/record-intro.mjs --model github-copilot/gpt-6.1-sol
```

The orders live in [`intro-episode.mjs`](intro-episode.mjs): a bare
"Computer.", a briefing that asks only Riker and Data for one short sentence
each, "Make it so, Number One." and "Mr Data, please run the tests and report
in one sentence." The crew builds a small tribute site with a stardate clock
in a fresh project with separate settings under the ignored
`video/out/episode-*` folder. Approvals are given before the take, in that
project's own `opencode.json`, so no approval request interrupts the episode.
The take stops at the first approval, alert or warning on screen and reports
it rather than saving a recording that hides it; grant what is needed in
`demoPermissions` or fix the cause, then record again. It also stops when
Nemotron did not hear an order word for word. Kokoro's pauses inside the
Captain's orders are shortened, so the app does not end his turn halfway.
After the work, the take opens the Captain's log so the finished entry can be
shown. A take takes five minutes or more. Do not use this tool on a private
project.

## Build and render the episode

The episode is a [HyperFrames](https://github.com/heygen-com/hyperframes)
project in [`video/`](../video/), pinned to version 0.9.15. Its scenes are
original LCARS compositions in `video/compositions/`: the opening hook and
dedication, title, officer name plates, caption bars and closing board.
`video/build.mjs` puts them around the recorded footage:

```sh
node video/build.mjs video/out/episode-EXAMPLE --sounds /path/to/sound-collection
cd video && npm run check
npx -y hyperframes@0.9.15 snapshot --at 5,20,40,80
npm run render
```

The first build times every spoken sentence with Kokoro
(`video/measure.py`, a few minutes) and writes a draft `edit.json` into the
episode folder. It keeps the Captain's orders, Riker's and Data's replies
whole (a reply is never cut inside), and two short silent glimpses of the
crew at work; everything else is left out. A reply longer than about
sixteen seconds, a missing reply, or a whole cut over 100 seconds means the
take is recorded again. Work captions stay short (30 characters at most) so
they end before the app's own title. Review the draft against the frames and
the rules in [AGENTS.md](../AGENTS.md), not only the storyboard; later builds
reuse it, so delete it to measure again. Captions always carry the exact
words that were spoken, worked out with the app's own speech rules.

`--sounds` is the folder with the owner's own collection of TNG sounds and
music (the `sounds` list in `edit.json` names the files used). The build
copies the chosen files, the app's downloaded computer sounds and the spoken
narration into the ignored `video/assets/` folder. Never commit them, and do
not use recordings of actors' voices. `video/index.html` is generated; edit
`edit.json` instead.

The episode folder's `youtube/` folder gets the chapter list, SRT captions
and a plain transcript for YouTube's automatic caption timing.

## Make the YouTube pack

Render the episode to `picard-code-episode.mp4` in the episode folder, then
write `youtube/picks.json` there: the parts of the episode each Short uses
and the episode second each thumbnail is drawn over (see the top of
[`video/youtube.mjs`](../video/youtube.mjs)). Cut Shorts only in silence;
the script refuses a cut through spoken words.

```sh
cd video && npx -y hyperframes@0.9.15 render -o ../video/out/episode-EXAMPLE/picard-code-episode.mp4 --quality delivery --video-frame-format png --keyframe-interval 2 --no-best-effort
cd .. && node video/youtube.mjs video/out/episode-EXAMPLE
```

It writes into `youtube/`: the upload file with its sound brought to
YouTube's level (about −14 LUFS; the picture is copied unchanged), three
1280×720 thumbnails for Test & Compare, vertical Shorts with burned-in
captions, the description with chapters, German, French and Spanish
descriptions, and `upload.txt` with titles, tags, settings and the pinned
comment. The words come from [`video/youtube.json`](../video/youtube.json).
Review the whole video, Shorts, thumbnails, sound levels, words and caption
timing before publication.
Keep all footage, audio, transcripts and local settings out of git.
Publishing on YouTube needs the owner's explicit approval.

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
