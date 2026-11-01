# Makes the video's voice lines with the same local Kokoro model Picard Code uses.
# All voices are stock Kokoro voices; neither is trained on or imitates a real actor.
# Run: ~/.picard-code/voice/bin/python3 video/speak.py  (after `npm run setup:speech` and the capture)
import json, pathlib, shutil, wave
import numpy as np
from kokoro_onnx import Kokoro

models = pathlib.Path.home() / ".picard-code" / "voice" / "models"
kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
assets = pathlib.Path(__file__).parent / "assets"
computer = json.loads((assets / "spoken.json").read_text())
lines = {
    "narrator-1": ("af_heart", 1.0, "This is Picard Code. You speak to your code, and an AI coding agent does the work, on a bridge inspired by Star Trek: The Next Generation."),
    "narrator-tech": ("af_heart", 1.0, "Under the hood, OpenCode does the coding, with the model provider you choose. Listening and speaking run on your own computer with Whisper and Kokoro, or in Azure with MAI voices."),
    "narrator-2": ("af_heart", 1.0, "With the bridge crew on, you can ask an officer by name."),
    "captain-1": ("bm_lewis", 0.9, "Computer. Mister Data, why do the shields read full when they are failing?"),
    "computer-1": ("bf_emma", 1.0, computer[0]),
    "captain-2": ("bm_lewis", 0.9, "Computer. Number One, fix it now, or after we reach Starbase seventy-four?"),
    "computer-2": ("bf_emma", 1.0, computer[1]),
    "narrator-3": ("af_heart", 1.0, "Now and then, the computer shares a page from Captain Picard's personnel file,"),
    "narrator-4": ("af_heart", 1.0, "or a fact about Sir Patrick Stewart."),
    "narrator-5": ("af_heart", 1.0, "Picard Code is free and open source. To try it, run N P X picard code. With deepest respect, to Sir Patrick Stewart."),
}
# The app's startup call is downloaded from TrekCore on first start; it is never committed.
shutil.copy(pathlib.Path.home() / ".picard-code" / "sounds" / "startup.mp3", assets / "startup.mp3")
lengths = {}
for name, (voice, speed, text) in lines.items():
    audio, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-gb")
    with wave.open(str(assets / f"{name}.wav"), "wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(rate)
        out.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    lengths[name] = round(len(audio) / rate, 2)
(assets / "lengths.json").write_text(json.dumps(lengths, indent=2) + "\n")
print(json.dumps(lengths))
