import hashlib
import os
import sys
from pathlib import Path
import urllib.request

from huggingface_hub import snapshot_download


# The models folder, given by setup-speech.mjs.
ROOT = Path(sys.argv[1])
ASSETS = {
    "kokoro-v1.0.onnx": "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}


def download(name, expected):
    target = ROOT / name
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
        print(f"Verified {name}")
        return
    temporary = target.with_suffix(target.suffix + ".download")
    url = f"https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/{name}"
    digest = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as output:
        while block := response.read(1024 * 1024):
            digest.update(block)
            output.write(block)
    if digest.hexdigest() != expected:
        temporary.unlink()
        raise RuntimeError(f"The published checksum does not match {name}. Nothing was installed.")
    os.replace(temporary, target)
    print(f"Downloaded and verified {name}")


ROOT.mkdir(parents=True, exist_ok=True)
for name, checksum in ASSETS.items():
    download(name, checksum)
snapshot_download(
    "Systran/faster-whisper-tiny.en",
    revision="0d3d19a32d3338f10357c0889762bd8d64bbdeba",
    local_dir=ROOT / "whisper-tiny.en",
    allow_patterns=["model.bin", "config.json", "tokenizer.json", "vocabulary.*", "README.md"],
    token=False,
)
print(f"Local speech models are ready in {ROOT}.")
