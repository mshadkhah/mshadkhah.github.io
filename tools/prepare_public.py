#!/usr/bin/env python3
"""Prepare self-hosted runtimes; the large Kokoro model stays on its upstream host."""
from pathlib import Path
import shutil, urllib.request
root = Path(__file__).resolve().parents[1]
local = root / '.local-tools'
public = root / 'tools/assets'
for directory in ['vendor','voices','ocr','licenses']:
    (public / directory).mkdir(parents=True, exist_ok=True)
for directory in ['vendor','voices','ocr']:
    for file in (local / directory).iterdir():
        if file.is_file(): shutil.copyfile(file, public / directory / file.name)
source = (local / 'package/dist/kokoro.web.js').read_text()
source = source.replace('https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/', '/tools/assets/voices/')
marker = 'export{Ef as KokoroTTS'
assert marker in source
source = source.replace(marker, 'Wg.allowLocalModels=false;Wg.allowRemoteModels=true;Wg.remotePathTemplate="{model}/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/";Wg.backends.onnx.wasm.numThreads=1;'+marker)
(public / 'vendor/kokoro.js').write_text(source)
licenses = {
 'TESSERACT-JS-LICENSE':'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/LICENSE.md',
 'TESSERACT-CORE-LICENSE':'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/LICENSE',
 'ONNX-RUNTIME-LICENSE':'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.21.0/LICENSE',
 'TRANSFORMERS-JS-LICENSE':'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/LICENSE',
 'PHONEMIZER-LICENSE':'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/LICENSE',
}
for name,url in licenses.items():
    dest=public/'licenses'/name
    if not dest.exists():
        try:
            with urllib.request.urlopen(url,timeout=30) as r: dest.write_bytes(r.read())
        except Exception as e: print(name,e)
print('Public reader assets prepared:', public)
