# Third-party notices

Picard Code uses original artwork, writing guidance, and generated test phrases.
It includes no Star Trek artwork, episode dialogue, recordings, or cloned
performer voices. The prebuilt speech voices are not affiliated with the show.
The computer sounds below are downloaded separately and are not part
of this repository.

The JavaScript dependencies are installed through npm. Local speech
dependencies and weights are downloaded separately, not bundled or committed.
Their installed license files and notices must be preserved.

## Included in the npm package

| Component | License and attribution | Source |
| --- | --- | --- |
| OpenCode 2 (installed by npm as one `@opencode/cli-*` package for the computer) | MIT; OpenCode contributors | [Project](https://github.com/anomalyco/opencode) |
| ws | MIT; copyright 2011 Einar Otto Stangvik, copyright 2013 Arnout Kazemier and contributors | [Project](https://github.com/websockets/ws) |
| marked (built into the browser page) | MIT; copyright 2018+ MarkedJS, copyright 2011-2018 Christopher Jeffrey | [Project](https://github.com/markedjs/marked) |
| DOMPurify (built into the browser page) | Apache 2.0 or MPL 2.0, used under Apache 2.0; copyright Cure53 and other contributors | [Project](https://github.com/cure53/DOMPurify) |
| Silero VAD v5 voice detector model (built into the browser page; taken from the `@ricky0123/vad-web` package, ISC) | MIT; copyright 2020-present Silero Team | [Project](https://github.com/snakers4/silero-vad), [vad-web](https://github.com/ricky0123/vad) |
| ONNX Runtime Web (built into the browser page; runs the voice detector) | MIT; Microsoft Corporation; its bundled components keep their own notices | [Project](https://github.com/microsoft/onnxruntime), [Notices](https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt) |
| Pele (Mermaid diagrams) | MIT; copyright 2026 kepano | [Project](https://github.com/obsidianmd/pele) |
| KaTeX (maths) | MIT; KaTeX contributors | [Project](https://github.com/KaTeX/KaTeX) |
| Pierre Highlights (code colouring, Pierre Dark theme) | Apache 2.0; Pierre contributors; bundled theme notices retained | [Package](https://www.npmjs.com/package/@pierre/highlights) |
| PDF.js | Apache 2.0; Mozilla Foundation and contributors | [Project](https://github.com/mozilla/pdf.js) |
| docx-preview | Apache 2.0; docx-preview contributors | [Project](https://github.com/VolodymyrBaydalka/docxjs) |
| BetterOffice XLSX and PPTX browser engines | Apache 2.0; BetterOffice contributors | [Project](https://github.com/openooxml/betteroffice) |
| BetterOffice font assets | Apache 2.0 for the package; the included Liberation Sans font is under SIL Open Font License 1.1, with Google and Red Hat copyright notices | [Fonts](https://github.com/openooxml/betteroffice/tree/main/packages/fonts) |
| JSZip and its browser helpers | JSZip is used under MIT, not its alternative GPL license; Stuart Knightley, David Duponchel, Franz Buchinger and Antonio Afonso; helper notices retained | [Project](https://github.com/Stuk/jszip) |

The browser build includes the rendering libraries' full license files and
available notices in `web-dist/renderer-notices.txt`, including the Liberation
font license and JSZip's bundled helper licenses. The file ships with the npm
package. These are separately loaded display engines, not a copy of OpenCode's
complete application or its private `@opencode/session-ui` package.

The integration follows OpenCode's browser choice of Pele, KaTeX and Pierre
Highlights, inspected at OpenCode commit
`21eaa626a37f77d7a8d80fa01997fa7d52506c97`. Picard's display adapters are
original code. OpenCode's built-in browser and terminal panels, document editing
and executable plugin hosting are not included.

## Local speech

`npx picard-code setup-speech` downloads these into the `.picard-code` folder
in the user's home folder.

| Component | License and attribution | Source |
| --- | --- | --- |
| NeMo-Speech.cpp 0.3.0 CPU runtime (only for Nemotron listening) | Apache 2.0; NVIDIA Corporation; the downloaded archive retains its component licenses and notices | [Project](https://github.com/NVIDIA/NeMo-Speech.cpp), [Release](https://github.com/NVIDIA/NeMo-Speech.cpp/releases/tag/v0.3.0) |
| Nemotron Speech Streaming English 0.6B Q8 weights | NVIDIA Open Model License, not Apache 2.0; NVIDIA Corporation. Licensed by NVIDIA Corporation under the NVIDIA Open Model License | [Model card](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b), [License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) |
| uv 0.13.6 (sets up Python; downloaded from its GitHub release and checked against a fixed checksum, only when uv is not already installed) | MIT or Apache 2.0; Astral Software Inc. | [Project](https://github.com/astral-sh/uv) |
| Python 3.11 (a python-build-standalone build, downloaded by uv) | Python Software Foundation License; the build includes libraries with their own notices | [Project](https://github.com/astral-sh/python-build-standalone) |
| kokoro-onnx | MIT; copyright 2025 github.com/thewh1teagle | [Project](https://github.com/thewh1teagle/kokoro-onnx) |
| Kokoro model and prebuilt voice data | Apache 2.0; Kokoro contributors | [Original model](https://huggingface.co/hexgrad/Kokoro-82M), [ONNX release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1) |
| phonemizer | GNU GPL version 3; phonemizer contributors | [Project](https://github.com/bootphon/phonemizer) |
| eSpeak NG | GNU GPL version 3 or later; eSpeak NG contributors | [Project](https://github.com/espeak-ng/espeak-ng) |
| espeakng-loader wrapper | MIT; copyright 2025 thewh1teagle; the wrapped eSpeak library has its own license | [Project](https://github.com/thewh1teagle/espeakng-loader) |
| ONNX Runtime | MIT; Microsoft Corporation | [Project](https://github.com/microsoft/onnxruntime) |

The selected services determine which files are downloaded. The pinned Python
dependencies are in `scripts/requirements-kokoro.txt`.
Every listening choice uses Python, NumPy and ONNX Runtime for the shared
pause detector. Azure-only and Nemotron-with-Azure-speaking preparation use
the smaller pinned set in `scripts/requirements-turn.txt`, without Kokoro's
speaking packages or models.
Other installed dependencies retain their
own license files and copyright notices; the table is not a replacement for
those files.

The setup script fixes the Nemotron model revision and checks
fixed SHA-256 hashes of the Nemotron runtime, model and model-license copy,
and of the Kokoro model and voices. The downloaded Nemotron runtime keeps
its own license files; the models folder also holds
`NVIDIA-Open-Model-License.pdf` and `NVIDIA-NOTICE.txt`. The license copy is
NVIDIA's dated October 24, 2025 PDF, checked against its fixed checksum,
rather than the changing license web page.
Downloads use public upstream sources,
not copied franchise material or recordings.

Before distributing a Python environment, native libraries, or model weights,
review and satisfy their licenses, including the GPL source and notice
requirements. Do not assume all
local speech dependencies are MIT licensed. This repository's download setup
does not grant permission to remove notices or bypass redistribution terms.

## Smart Turn pause detection

Speech preparation downloads `smart-turn-v3.2-cpu.onnx` from
[Pipecat Smart Turn](https://huggingface.co/pipecat-ai/smart-turn-v3).
It is BSD-2-Clause, copyright 2024-2025 Daily. Its full license is included in
`scripts/smart-turn-LICENSE.txt` and copied beside the downloaded model in
`~/.picard-code/voice/models`. The download is checked against a fixed SHA-256
checksum and a fixed public revision. No model weights or evaluation recordings
are shipped with the app.

The local worker uses the existing NumPy and ONNX Runtime installation.
Its audio feature calculation is independently implemented for the model's
input format. The model uses a Whisper-derived encoder to judge whether
speech sounds complete; it does not transcribe speech or restore the retired
Whisper listener. Nemotron and Azure remain the listening choices.

## Computer sounds

Picard Code automatically downloads four short sound files from
[TrekCore](https://www.trekcore.com/audio/) into the `.picard-code/sounds`
folder in the user's home folder on first startup. `npm run setup:sounds` can also check and download
them. The project owner chose the existing three computer sounds and confirmed
permission to use those files. The added startup call is listed by TrekCore
as “Hail All Ship” under Next Generation Era Computer Sounds; it is not
claimed to be the exact recording from Picard's arrival ceremony.
These recordings are not covered by this project's license, are not
redistributed in this repository, and no license or redistribution permission
is granted here.

| Used for | Source |
| --- | --- |
| The Captain's arrival at startup | https://www.trekcore.com/audio/computer/hail_allship_ep.mp3 |
| A spoken request was accepted | https://www.trekcore.com/audio/computer/computer_work_beep.mp3 |
| Speech was not understood or could not be sent | https://www.trekcore.com/audio/computer/input_failed_clean.mp3 |
| An accepted request finally failed or was denied | https://www.trekcore.com/audio/computer/denybeep1.mp3 |

## Development tools

`.github/skills/ponytail-review` is the review skill from
[Ponytail](https://github.com/DietrichGebert/ponytail) v5.3.3 (commit
`7801d061243d7b753bad0e0b3c057cd250b11755`), copied unchanged under the MIT
license; copyright 2026 DietrichGebert. Its license is kept beside it. It is
used only to review changes to this repository, not by the app.

`.github/workflows/code-simplifier.md` is adapted from the Code Simplifier
workflow in [Agentics](https://github.com/githubnext/agentics) (commit
`139fa09ef17cde4135e696ff8e7af09bc5ddfa6e`), and
`.github/workflows/shared/formatting.md` and `reporting.md` are copied
unchanged from it, under the MIT license; copyright 2025 GitHub. Its license
is kept in `.github/workflows/shared/LICENSE`. They are used only by a
GitHub workflow for this repository, not by the app or the npm package.

`tools/voice-match` measured which ready-made voices sound closest to each
actor. It is not part of the npm package or the app. When run, it downloads
its Python packages and these speaker-recognition models into
`~/.picard-code/voice-match`; none are committed or shipped:

| Model | License | Source |
| --- | --- | --- |
| ReDimNet2 b6 | MIT; PalabraAI | [Project](https://github.com/PalabraAI/redimnet2) |
| ReDimNet b6 | MIT; ID R&D | [Project](https://github.com/IDRnD/ReDimNet) |
| WeSpeaker ResNet293-LM | CC BY 4.0; WeNet community | [Model card](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet293-LM) |
| SpeechBrain ECAPA-TDNN | Apache 2.0; SpeechBrain | [Model card](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb) |
| ECAPA2 | CC BY-NC 4.0 (non-commercial); Jenthe Thienpondt | [Model card](https://huggingface.co/Jenthe/ECAPA2) |
| WavLM Base Plus SV | MIT; Microsoft | [Model card](https://huggingface.co/microsoft/wavlm-base-plus-sv) |

The actor clips it compares against are the user's own and stay on their
computer. Only the measured scores are kept, in
`docs/research/audition-data/crew-voice-match.json`.

## Hosted services

OpenCode performs coding through the model provider the user chooses, under
that provider's own terms.
Microsoft's MAI listening and speaking are hosted Azure services, subject to
their service terms, preview availability, and usage charges. No service
credentials or hosted model weights are included in this repository.
