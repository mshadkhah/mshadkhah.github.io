'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const offline = location.hostname === '127.0.0.1' && location.port === '8001';
  // Claude text extraction through the Cloudflare Worker in tools/ai-ocr-worker. Leave empty to use only on-device PaddleOCR.
  const AI_OCR_URL = 'https://mshadkhah-ai-ocr.mshadkhah.workers.dev';
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const engine = $('reader-engine');
  const aiVoiceOptions = $('reader-voice').innerHTML;
  let localVoices = [], deviceSpeaking = false, deviceRun = 0, utterance;
  const upload = $('reader-file'), text = $('reader-text'), status = $('reader-status');
  $('tools-open-reader').addEventListener('click', () => {
    $('tools-directory').hidden = true; $('tools-reader-detail').hidden = false;
    $('tools-back').focus();
  });
  $('tools-back').addEventListener('click', () => {
    $('reader-audio').pause(); stopDevice(); controls();
    $('tools-reader-detail').hidden = true; $('tools-directory').hidden = false;
    $('tools-open-reader').focus();
  });
  const audio = $('reader-audio'), download = $('reader-download'), progress = $('reader-progress');
  let busy = false, imageURL, audioURL, imageBlob, voiceWorker, ocrWorker, token = 0;
  function report(message, value) {
    status.textContent = message;
    progress.hidden = !busy;
    if (value === undefined) progress.removeAttribute('value'); else progress.value = value;
  }
  function controls() {
    $('reader-extract').disabled = busy || !imageBlob;
    $('reader-speak').disabled = busy || !text.value.trim();
    $('reader-stop').hidden = !busy && !deviceSpeaking;
    for (const id of ['reader-file','reader-camera-button','reader-camera','reader-text','reader-voice','reader-speed','reader-engine','reader-example','reader-clear']) $(id).disabled = busy;
    $('reader-count').textContent = `${text.value.length.toLocaleString()} / 6,000 characters`;
    $('reader-card').setAttribute('aria-busy', String(busy));
  }
  function finish(message) { busy = false; controls(); report(message); }
  function resetAudio() {
    stopDevice(); audio.pause(); audio.removeAttribute('src'); audio.load();
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = null; $('reader-result').hidden = true;
    download.removeAttribute('href'); audio.hidden = false; download.hidden = false; $('reader-play').textContent = 'Play narration';
  }
  function wav(samples, rate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
    const str = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    str(0,'RIFF'); view.setUint32(4,36 + samples.length * 2,true); str(8,'WAVE'); str(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,rate,true); view.setUint32(28,rate * 2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    str(36,'data'); view.setUint32(40,samples.length * 2,true);
    samples.forEach((s,i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1,s)) * (s < 0 ? 32768 : 32767), true));
    return new Blob([buffer], {type:'audio/wav'});
  }
  async function loadImage(event) {
    const picker = event.currentTarget;
    const file = picker.files[0]; if (!file) return;
    const run = ++token;
    if (!(file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|bmp)$/i.test(file.name)) || file.size > 20 * 1024 * 1024) {
      picker.value = ''; report('Choose a photo or screenshot smaller than 20 MB.'); return;
    }
    busy = true; controls(); resetAudio(); report('Opening your photo on this device…');
    let sourceURL;
    try {
      // Safari's native image decoder supports iPhone HEIC and photo orientation.
      // Draw into a small canvas rather than allocating a full-resolution OCR canvas.
      sourceURL = URL.createObjectURL(file);
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error('This browser cannot open the photo. Try Safari 17 or later for HEIC, or choose a screenshot or JPEG.')); image.src = sourceURL; });
      if (run !== token) return;
      if (image.naturalWidth * image.naturalHeight > 100000000) throw Error('This photo is too large. Choose a smaller image or screenshot.');
      const scale = Math.min(1, (isAppleMobile ? 1800 : 2400) / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg', 0.92));
      canvas.width = canvas.height = 1; image.src = '';
      if (run !== token) return;
      if (!blob) throw Error('Could not open this image. Try a PNG or JPEG.');
      if (imageURL) URL.revokeObjectURL(imageURL);
      imageBlob = blob; imageURL = URL.createObjectURL(blob); text.value = '';
      $('reader-preview').src = imageURL; $('reader-preview').hidden = false;
      $('reader-filename').textContent = file.name; resetAudio();
      finish('Image ready. Extract the text, then review it before listening.');
    } catch (error) { if (run === token) finish(error.message); }
    finally { if (sourceURL) URL.revokeObjectURL(sourceURL); picker.value = ''; }
  }
  async function extractWithClaude(blob) {
    const dataURL = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('could not read the photo')); reader.readAsDataURL(blob); });
    const response = await fetch(AI_OCR_URL, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ image: dataURL.slice(dataURL.indexOf(',') + 1) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'service error ' + response.status);
    return (data.text || '').trim();
  }
  upload.addEventListener('change', loadImage);
  $('reader-camera').addEventListener('change', loadImage);
  $('reader-camera-button').addEventListener('click', () => $('reader-camera').click());
  $('reader-extract').addEventListener('click', async () => {
    const run = ++token; busy = true; controls(); resetAudio();
    if (AI_OCR_URL) {
      report('Reading text with Claude…');
      try {
        const aiText = await extractWithClaude(imageBlob);
        if (run !== token) return;
        text.value = aiText.slice(0,6000);
        finish(!aiText ? 'No text found. Try a sharper photo, with the page filling the frame.' : aiText.length > 6000 ? 'Text extracted with Claude. The first 6,000 characters are shown; use smaller sections for the rest.' : 'Text extracted with Claude. Review the text before listening.');
        return;
      } catch (error) {
        if (run !== token) return;
        report('Claude could not read this photo (' + error.message + '). Trying on-device OCR…');
      }
    }
    report('Loading PaddleOCR… First use downloads the text models.');
    let worker;
    try {
      const { PaddleOCR } = await import('/tools/assets/paddle/paddle.mjs');
      if (run !== token) return;
      const base = new URL('/tools/assets/paddle/', location.href).href;
      // The SDK creates its worker lazily, so the error listener is attached inside createWorker.
      let stopWithError;
      const failed = new Promise((_, reject) => { stopWithError = reject; });
      failed.catch(() => {});
      const ocr = await PaddleOCR.create({
        initialize: false,
        textDetectionModelName: 'PP-OCRv5_mobile_det',
        textRecognitionModelName: 'PP-OCRv5_mobile_rec',
        textDetectionModelAsset: {url: base + 'PP-OCRv5_mobile_det.tar'},
        textRecognitionModelAsset: {url: base + 'PP-OCRv5_mobile_rec.tar'},
        textRecognitionBatchSize: 1,
        worker: {createWorker: () => {
          worker = new Worker(base + 'assets/worker-entry-C9UNuyOJ.js', {type:'module'});
          ocrWorker = worker;
          worker.addEventListener('error', () => stopWithError(Error('The OCR worker stopped. Try a smaller photo or close other tabs.')), {once:true});
          return worker;
        }},
        ortOptions: {backend:'wasm', wasmPaths:base, numThreads:1}
      });
      await Promise.race([ocr.initialize(), failed]);
      if (run !== token) return;
      report('Reading text with PaddleOCR…');
      const [result] = await Promise.race([ocr.predict(imageBlob, {textDetLimitSideLen:1536, textDetLimitType:'max'}), failed]);
      if (run !== token) return;
      const extracted = result.items.map(item => item.text).join('\n').trim();
      text.value = extracted.slice(0,6000);
      finish(!extracted ? 'No text found. Try a sharper photo, with the page filling the frame.' : extracted.length > 6000 ? 'Text extracted. The first 6,000 characters are shown; use smaller sections for the rest.' : 'Text extracted with PaddleOCR. Review the text and reading order before listening.');
    } catch (error) {
      if (run === token) finish('Could not read the image: ' + error.message);
    } finally {
      worker?.terminate();
      if (ocrWorker === worker) ocrWorker = null;
    }
  });
  $('reader-speak').addEventListener('click', () => {
    const content = text.value.trim(); if (!content || content.length > 6000) return;
    if (engine.value === 'device') { startDevice(content); return; }
    busy = true; controls(); resetAudio(); report('Preparing Kokoro… First use may take a little longer.');
    if (!voiceWorker) {
      voiceWorker = new Worker('/tools/reader-worker.js?v=2', {type:'module'});
      voiceWorker.onmessage = ({data}) => {
        if (data.type === 'status') report(data.text, data.progress);
        if (data.type === 'error') { voiceWorker.terminate(); voiceWorker = null; finish('Kokoro could not finish. Try Device voice, or a shorter passage. ' + data.text); }
        if (data.type === 'audio') {
          // Release model memory before playback (important on memory-constrained browsers).
          voiceWorker.terminate(); voiceWorker = null;
          audioURL = URL.createObjectURL(wav(data.samples, data.rate)); audio.src = audioURL; download.href = audioURL;
          $('reader-result').hidden = false; finish('Narration ready. Press play to listen, or download the WAV file.');
        }
      };
      voiceWorker.onerror = () => { voiceWorker.terminate(); voiceWorker = null; finish('Kokoro could not start on this device. Choose Device voice, or try a desktop browser.'); };
    }
    voiceWorker.postMessage({text:content, voice:$('reader-voice').value, speed:Number($('reader-speed').value)});
  });
  $('reader-stop').addEventListener('click', () => {
    token++; stopDevice(); voiceWorker?.terminate(); voiceWorker = null;
    ocrWorker?.terminate(); ocrWorker = null;
    $('reader-play').textContent = 'Play narration';
    finish('Cancelled. Your image and text are still here.');
  });
  text.addEventListener('input', () => { resetAudio(); controls(); });
  for (const id of ['reader-voice','reader-speed']) $(id).addEventListener('change', () => { resetAudio(); controls(); });
  $('reader-example').addEventListener('click', () => {
    text.value = 'Hello, I’m your image reader. Upload a picture, review the extracted text, and I’ll read it aloud. Everything runs locally on your own computer.';
    resetAudio(); controls(); report('Sample text ready. Choose a voice and create narration.');
  });
  $('reader-clear').addEventListener('click', () => {
    text.value = ''; upload.value = ''; $('reader-camera').value = ''; imageBlob = null;
    if (imageURL) URL.revokeObjectURL(imageURL); imageURL = null;
    $('reader-preview').removeAttribute('src'); $('reader-preview').hidden = true; $('reader-filename').textContent = 'Photo Library, camera, or files · up to 20 MB';
    resetAudio(); controls(); report('Ready for an image or pasted text.');
  });
  $('reader-play').addEventListener('click', async () => {
    if (engine.value === 'device') {
      if (!deviceSpeaking) { startDevice(text.value.trim()); return; }
      if (speechSynthesis.paused) { speechSynthesis.resume(); $('reader-play').textContent = 'Pause narration'; }
      else { speechSynthesis.pause(); $('reader-play').textContent = 'Resume narration'; }
      return;
    }
    try { if (audio.paused) await audio.play(); else audio.pause(); }
    catch (error) { report('Playback could not start. Try downloading the audio.'); }
  });
  audio.addEventListener('play', () => { $('reader-play').textContent = 'Pause narration'; });
  audio.addEventListener('pause', () => { $('reader-play').textContent = 'Play narration'; });
  audio.addEventListener('ended', () => { $('reader-play').textContent = 'Play narration'; });
  function stopDevice() {
    deviceRun++; deviceSpeaking = false;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    utterance = null;
  }
  function updateVoiceOptions() {
    if (engine.value === 'kokoro') {
      $('reader-voice').innerHTML = aiVoiceOptions;
      $('reader-engine-note').textContent = offline ? 'Kokoro uses the voice model installed on this computer.' : 'Natural AI narration. Downloads about 90 MB on first use; may be slow on phones. Text is processed on your device.';
      $('reader-speak').firstChild.textContent = 'Create narration ';
    } else {
      localVoices = window.speechSynthesis?.getVoices().filter(v => v.localService && /^en(?:-|_|$)/i.test(v.lang)) || [];
      $('reader-voice').replaceChildren();
      localVoices.forEach((v,i) => { const option = new Option(`${v.name} · ${v.lang}`, String(i)); $('reader-voice').add(option); });
      if (!localVoices.length) $('reader-voice').add(new Option('Waiting for an installed English voice…',''));
      $('reader-engine-note').textContent = 'Uses an installed on-device English voice. No AI model download; audio download is available only with Kokoro.';
      $('reader-speak').firstChild.textContent = 'Read aloud ';
    }
  }
  function startDevice(content) {
    if (!('speechSynthesis' in window)) { report('Device speech is unavailable. Choose Kokoro instead.'); return; }
    const voice = localVoices[Number($('reader-voice').value)];
    if (!voice) { updateVoiceOptions(); report('No installed English voice is available yet. On iPhone, check Settings → Accessibility → Read & Speak (or Spoken Content) → Voices, or choose Kokoro.'); return; }
    resetAudio(); deviceSpeaking = true; const run = ++deviceRun;
    audio.hidden = true; download.hidden = true; $('reader-result').hidden = false;
    $('reader-play').textContent = 'Pause narration'; controls(); report('Reading with your device voice…');
    const sentences = content.match(/[^.!?]+[.!?]*/g) || [content];
    const parts = [];
    for (const sentence of sentences) {
      let part = '';
      for (const word of sentence.split(/\s+/)) {
        if ((part + word).length > 200 && part) { parts.push(part); part = ''; }
        part += word + ' ';
      }
      if (part.trim()) parts.push(part.trim());
    }
    let index = 0;
    function next() {
      if (run !== deviceRun) return;
      if (index >= parts.length) { deviceSpeaking = false; controls(); $('reader-play').textContent = 'Play narration'; report('Finished reading.'); return; }
      utterance = new SpeechSynthesisUtterance(parts[index++]); utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = Number($('reader-speed').value);
      utterance.onend = next;
      utterance.onerror = event => { if (run !== deviceRun) return; stopDevice(); controls(); $('reader-play').textContent = 'Play narration'; report('Device speech stopped. Tap Read aloud to retry.'); };
      speechSynthesis.speak(utterance);
    }
    next();
  }
  engine.addEventListener('change', () => { resetAudio(); updateVoiceOptions(); controls(); });
  if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', () => { if (engine.value === 'device' && !deviceSpeaking) updateVoiceOptions(); });
  if (isAppleMobile && 'speechSynthesis' in window) engine.value = 'device';
  updateVoiceOptions();
  window.addEventListener('pagehide', () => {
    token++; stopDevice(); voiceWorker?.terminate(); ocrWorker?.terminate();
    voiceWorker = ocrWorker = null; imageBlob = null;
    if (imageURL) URL.revokeObjectURL(imageURL);
    resetAudio(); text.value = ''; upload.value = ''; $('reader-camera').value = ''; $('reader-preview').removeAttribute('src'); $('reader-preview').hidden = true;
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { busy = false; controls(); report('Ready for an image or pasted text.'); } });
  controls();
})();
