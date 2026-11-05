# Makes the video's voice lines with the same local Kokoro model Picard Code uses.
# All voices are stock Kokoro voices; neither is trained on or imitates a real actor.
# Run: ~/.picard-code/voice/bin/python3 video/speak.py  (after `npm run setup:speech` and the capture)
import json, pathlib, shutil, subprocess, wave
import numpy as np
from kokoro_onnx import Kokoro

models = pathlib.Path.home() / ".picard-code" / "voice" / "models"
kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
assets = pathlib.Path(__file__).parent / "assets"
shutil.copy(pathlib.Path(__file__).parent.parent / "site" / "assets" / "mark.svg", assets / "mark.svg")
voices = json.loads(subprocess.run(
    ["node", "--input-type=module", "-e",
     "import { COMPUTER_VOICES, CREW_VOICES } from './dist/shared/crew-voices.js'; console.log(JSON.stringify({computer: COMPUTER_VOICES.kokoro, data: CREW_VOICES['picard-data'].kokoro, riker: CREW_VOICES['picard-riker'].kokoro}));"],
    cwd=pathlib.Path(__file__).parent.parent, check=True, capture_output=True, text=True,
).stdout)
computer = json.loads((assets / "spoken.json").read_text())
answer = json.loads((assets / "answer-spoken.json").read_text())[0]
lines = {
    "narrator-1": ("af_heart", 1.0, "An unofficial tribute to Sir Patrick Stewart and Captain Jean-Luc Picard. No typing. Say Computer, give your order, and hear an answer."),
    "narrator-2": ("af_heart", 1.0, "This is the current interface, with staged example answers."),
    "captain-example": ("bm_george", 1.0, "Computer, why is the settings test failing?"),
    "computer-example": (voices["computer"], 1.0, answer),
    "narrator-crew": ("af_heart", 1.0, "Call on the bridge crew for their expertise. Each officer has a different ready-made voice."),
    "captain-1": ("bm_george", 1.0, "Computer. Mister Data, why do the shields read full when they are failing?"),
    "computer-1": (voices["data"], 1.0, computer[0]),
    "captain-2": ("bm_george", 1.0, "Computer. Number One, fix it now, or after we reach Starbase seventy-four?"),
    "computer-2": (voices["riker"], 1.0, computer[1]),
    "narrator-log": ("af_heart", 1.0, "Return to your entries in Captain's log. Tribute facts appear separately, with their sources."),
    "narrator-tech": ("af_heart", 1.0, "Nemotron listens and Kokoro speaks on your computer. OpenCode two connects the AI provider you choose. Online providers receive your requests and relevant project content."),
    "narrator-5": ("af_heart", 1.0, "Free and open source. To try it, run N P X picard code. With deepest respect and gratitude to Sir Patrick Stewart."),
}
lengths = {}
for name, (voice, speed, text) in lines.items():
    audio, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-gb" if voice.startswith("b") else "en-us")
    with wave.open(str(assets / f"{name}.wav"), "wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(rate)
        out.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    lengths[name] = round(len(audio) / rate, 2)
(assets / "lengths.json").write_text(json.dumps(lengths, indent=2) + "\n")
(assets / "lines.json").write_text(json.dumps({name: text for name, (_, _, text) in lines.items()}, indent=2) + "\n")
print(json.dumps(lengths))
