// Port 8001 is the fully offline preview; other origins use deployment assets.
const offline = self.location.hostname === '127.0.0.1' && self.location.port === '8001';
const base = offline ? '/.local-tools' : '/tools/assets';
let tts, KokoroTTS;
function chunks(text) {
  const sentences = text.match(/[^.!?\n]+[.!?]*|\n+/g) || [text];
  const result = [];
  let current = '';
  for (const sentence of sentences) {
    for (const word of sentence.trim().split(/\s+/)) {
      if (!word) continue;
      if ((current + ' ' + word).length > 180 && current) { result.push(current); current = ''; }
      // Long unbroken strings are not useful narration; cap each token before synthesis.
      for (let i = 0; i < word.length; i += 140) {
        const part = word.slice(i, i + 140);
        if ((current + ' ' + part).length > 180 && current) { result.push(current); current = ''; }
        current += (current ? ' ' : '') + part;
      }
    }
    if (current.length > 110) { result.push(current); current = ''; }
  }
  if (current) result.push(current);
  return result;
}
self.onmessage = async ({data}) => {
  try {
    if (!tts) {
      self.postMessage({type:'status', text:offline ? 'Loading the local Kokoro voice model…' : 'Loading Kokoro (about 90 MB on first use)…'});
      if (!KokoroTTS) {
        const library = await import(`${base}/vendor/kokoro.js`);
        KokoroTTS = library.KokoroTTS; library.env.wasmPaths = `${base}/vendor/`;
      }
      tts = await KokoroTTS.from_pretrained(offline ? 'kokoro' : 'onnx-community/Kokoro-82M-v1.0-ONNX', {dtype:'q8', device:'wasm', progress_callback: info => { if (typeof info.progress === 'number') self.postMessage({type:'status', text:`Loading voice model… ${Math.round(info.progress)}%`, progress:info.progress / 100}); }});
    }
    const parts = chunks(data.text);
    const audioParts = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      self.postMessage({type:'status', text:`Creating narration ${i + 1} of ${parts.length}…`, progress:i / parts.length});
      const audio = await tts.generate(parts[i], {voice:data.voice, speed:data.speed});
      audioParts.push(audio.audio); total += audio.audio.length;
      if (i < parts.length - 1) { const gap = new Float32Array(3600); audioParts.push(gap); total += gap.length; }
    }
    const samples = new Float32Array(total);
    let offset = 0;
    for (const part of audioParts) { samples.set(part, offset); offset += part.length; }
    self.postMessage({type:'audio', samples, rate:24000}, [samples.buffer]);
  } catch (error) { self.postMessage({type:'error', text:error.message || String(error)}); }
};
