#!/usr/bin/env python3
"""Download pinned browser runtimes and models for the local image reader."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request, tarfile, shutil
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / '.local-tools'
for folder in ['vendor', 'models/kokoro/onnx', 'voices', 'ocr']:
    (ASSETS / folder).mkdir(parents=True, exist_ok=True)
REV = '1939ad2a8e416c0acfeecc08a694d14ef25f2231'
def download(item):
    url, relative = item
    dest = ASSETS / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        temp = dest.with_suffix(dest.suffix + '.part')
        with urllib.request.urlopen(url, timeout=180) as response, temp.open('wb') as out:
            shutil.copyfileobj(response, out)
        temp.replace(dest)
    print('Ready:', relative, flush=True)
files = [('https://registry.npmjs.org/kokoro-js/-/kokoro-js-1.2.1.tgz', 'kokoro.tgz')]
for name in ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']:
    files.append((f'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/{REV}/{name}', 'models/kokoro/' + name))
for name in ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']:
    files.append((f'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/{name}', 'vendor/' + name))
for name in ['tesseract.min.js','worker.min.js']:
    files.append((f'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/{name}', 'ocr/' + name))
for name in ['tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm']:
    files.append((f'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/{name}', 'ocr/' + name))
files.append(('https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz', 'ocr/eng.traineddata.gz'))
with ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(download, files))
with tarfile.open(ASSETS / 'kokoro.tgz') as tar:
    for member in tar.getmembers():
        if member.isfile() and (member.name.startswith('package/voices/') or member.name in ['package/dist/kokoro.web.js','package/LICENSE']):
            target = ASSETS / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as src, target.open('wb') as dest:
                shutil.copyfileobj(src, dest)
source = (ASSETS / 'package/dist/kokoro.web.js').read_text()
source = source.replace('https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/', '/.local-tools/voices/')
marker = 'export{Ef as KokoroTTS'
assert marker in source, 'Unexpected Kokoro bundle; review setup patch.'
source = source.replace(marker, 'Wg.allowRemoteModels=false;Wg.allowLocalModels=true;Wg.localModelPath="/.local-tools/models/";Wg.backends.onnx.wasm.numThreads=1;'+marker)
(ASSETS / 'vendor/kokoro.js').write_text(source)
for voice in ['af_heart','af_bella','am_michael','bf_emma']:
    shutil.copyfile(ASSETS / f'package/voices/{voice}.bin', ASSETS / f'voices/{voice}.bin')
shutil.copyfile(ASSETS / 'package/LICENSE', ASSETS / 'vendor/KOKORO-LICENSE')
print('Offline reader assets installed. Start: python3 tools/serve_local.py', flush=True)
