# Mehdi Shadkhah — personal website

CFD, scientific computing, research, publications, and open-source software.

Live website: https://mshadkhah.github.io

Run locally with `python3 -m http.server 8000`, then open http://127.0.0.1:8000.

Private analytics: https://mshadkhah.github.io/admin.html (owner GitHub sign-in). Dashboard backend and secrets are managed separately in Cloudflare Workers. Local previews do not send website analytics.

The background flow in `flow.js` uses a small velocity grid with pressure projection and Canvas particle trails. Move the cursor to stir, use “Stir the flow” for a pulse, or pause with the motion button. Reduced-motion preferences start the animation paused; hidden tabs stop rendering. No extra dependencies are required.

## Tools: Image to Speech

The Tools directory includes an English image reader with Claude text extraction (through the Cloudflare Worker in tools/ai-ocr-worker, which forwards the photo to Anthropic and stores nothing), on-device PaddleOCR as a fallback, Kokoro narration, and installed device voices. Photos, extracted text, and generated audio remain in browser memory; the site itself stores no images or text. Clear and page exit release the image. Model files may be cached by the browser. Downloading narration explicitly saves a WAV file on the user's device.

### Phones and deployment

- The native image picker allows photo-library, camera, or file selection. A dedicated Take a photo button uses capture="environment" to request the rear camera on supported phones; desktop browsers may show a file picker instead. Safari 17+ decodes iPhone HEIC/HEIF; unsupported formats show a JPEG/screenshot fallback message.
- Images up to 20 MB are resized before OCR (1,800 px on iPhone/iPad, 2,400 px elsewhere); narration is limited to 6,000 characters.
- iPhone/iPad defaults to installed local English voices via SpeechSynthesis. Only voices marked localService are offered. Kokoro is optional; its large memory requirement may exceed mobile browser limits.
- Kokoro downloads a pinned ~88 MiB q8 model from Hugging Face on first use. Text and inference stay on device. All other runtimes, OCR data, and four Kokoro voices are self-hosted under tools/assets.
- GitHub Pages serves main from the repository root. .nojekyll keeps the site static. No API key or backend is required.
- Tested photo decoding/OCR, public-model synthesis, device speech, cancellation, audio playback, and a 390px mobile layout. A physical iPhone photo-picker test still needs to be performed on an actual device.

To regenerate the checked-in public runtimes after the one-time offline setup:

```sh
python3 tools/prepare_public.py
```

### Fully offline local preview

One-time download (internet required):

```sh
python3 tools/setup_offline.py
```

Then, including while offline:

```sh
python3 tools/serve_local.py
```

Open http://127.0.0.1:8001/?section=tools. Port 8001 deliberately uses the ignored .local-tools directory and restricts resources to the local origin. Other origins use the deployment assets and upstream model. The first narration loads the model into memory; generation can take time. Cancellation and completed narration unload the voice worker. Device speech requires an installed local English voice.

### Dependencies

Kokoro JS 1.2.1, Transformers.js 3.5.1 / ONNX Runtime 1.21.0, Tesseract.js 6.0.1, Tesseract.js core 6.0.0, and English fast language data. Kokoro model revision: 1939ad2a8e416c0acfeecc08a694d14ef25f2231. Third-party license files are included in tools/assets/licenses and tools/assets/vendor/KOKORO-LICENSE. The Kokoro browser bundle is patched only to set model/voice paths and single-threaded WASM; prepare_public.py reproduces these modifications from the original npm package. Upstream projects: https://github.com/hexgrad/kokoro and https://github.com/naptha/tesseract.js.
