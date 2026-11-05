# Speaks the Captain's log lines with the same local Kokoro model Picard Code uses.
# bm_daniel is a stock Kokoro voice; it is not trained on or imitating any actor.
# Run through build.mjs, which writes the lines file:
#   ~/.picard-code/voice/bin/python3 video/speak.py <lines.json> <output folder>
import json, pathlib, sys, wave
import numpy as np
from kokoro_onnx import Kokoro

lines_file, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
models = pathlib.Path.home() / ".picard-code" / "voice" / "models"
kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
lengths = {}
for name, line in json.loads(lines_file.read_text()).items():
    voice = line["voice"]
    audio, rate = kokoro.create(line["text"], voice=voice, speed=line.get("speed", 1.0), lang="en-gb" if voice.startswith("b") else "en-us")
    with wave.open(str(output / f"{name}.wav"), "wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(rate)
        out.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    lengths[name] = round(len(audio) / rate, 3)
print(json.dumps(lengths))
