// Cloudflare Worker: receives one photo from the reader, asks Claude for its text, and returns only that text.
// The Anthropic key is stored as a Worker secret (ANTHROPIC_API_KEY) and never reaches the browser.
// Photos are forwarded to Anthropic and are not written to storage by this Worker.

const ALLOWED_ORIGINS = ['https://mshadkhah.github.io', 'http://127.0.0.1:8001'];
const MAX_BODY_CHARS = 8_000_000; // base64 JPEG; the reader sends roughly 1-3 MB
const PROMPT = [
  'This photo shows one book page, and it may be rotated or tilted.',
  'First work out the orientation so the text reads normally.',
  'Transcribe all of the text on the main page, the page that fills the frame.',
  'Ignore any text from a neighboring page visible at the edge.',
  'Output only the transcribed text, keeping paragraph breaks.',
  'Join words split by a hyphen at the end of a line (for example "Sen-" plus "eca" becomes "Seneca").',
  'Do not add commentary, descriptions, translations, or markdown.',
  'If there is no readable text at all, output nothing.'
].join(' ');

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// /speak forwards narration text to the Kokoro server at home. The Kokoro token stays in this Worker's secrets.
async function handleSpeak(request, env, headers) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== 'string' || !body.text.trim()) return json({ error: 'Missing text' }, 400, headers);
  if (body.text.length > 60000) return json({ error: 'Text is too long' }, 413, headers);

  let upstream;
  try {
    upstream = await fetch(env.KOKORO_URL + '/speak', {
      method: 'POST',
      headers: { 'X-Token': env.KOKORO_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: body.text, voice: String(body.voice || 'af_heart'), speed: Number(body.speed) || 1 })
    });
  } catch (error) {
    return json({ error: 'Voice server is unreachable.' }, 502, headers);
  }
  if (!upstream.ok) return json({ error: 'Voice server returned ' + upstream.status }, 502, headers);
  // Stream the audio through instead of buffering it, so long narrations stay within Worker memory limits.
  return new Response(upstream.body, { status: 200, headers: { ...headers, 'Content-Type': 'audio/wav' } });
}

// /name asks Claude for a short file name such as Goeman_Gendered-Geographies_p542-543.
const NAME_PROMPT = [
  'This is text from a book, and the photo may show the page with its page number.',
  'Suggest a short file name for an audio recording of this text.',
  'Include the author\'s last name, a short title, and the page number(s) if you can read them in the photo.',
  'Example: Goeman_Gendered-Geographies_p542-543.',
  'Use only letters, digits, hyphens, and underscores. Reply with JSON only, like {"name": "..."}.'
].join(' ');

async function handleName(request, env, headers) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== 'string') return json({ error: 'Missing text' }, 400, headers);

  const content = [];
  if (typeof body.image === 'string' && body.image.length && body.image.length <= MAX_BODY_CHARS) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.image } });
  }
  content.push({ type: 'text', text: NAME_PROMPT + '\n\nText:\n' + body.text.slice(0, 3000) });

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.CLAUDE_MODEL || 'claude-haiku-5-5', max_tokens: 100, messages: [{ role: 'user', content }] })
    });
  } catch (error) {
    return json({ error: 'Name service is unreachable.' }, 502, headers);
  }
  if (!upstream.ok) return json({ error: 'Name service returned an error.' }, 502, headers);

  const data = await upstream.json();
  const reply = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
  let name = '';
  try { name = JSON.parse(reply.match(/\{[\s\S]*\}/)[0]).name || ''; } catch (error) { name = ''; }
  name = name.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 80);
  return json({ name: name || 'narration' }, 200, headers);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Origin not allowed' }, 403, headers);
    if (new URL(request.url).pathname === '/speak') return handleSpeak(request, env, headers);
    if (new URL(request.url).pathname === '/name') return handleName(request, env, headers);

    const body = await request.json().catch(() => null);
    if (!body || typeof body.image !== 'string' || !body.image.length) return json({ error: 'Missing image' }, 400, headers);
    if (body.image.length > MAX_BODY_CHARS) return json({ error: 'Image is too large' }, 413, headers);

    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: env.CLAUDE_MODEL || 'claude-haiku-5-5',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.image } },
              { type: 'text', text: PROMPT }
            ]
          }]
        })
      });
    } catch (error) {
      return json({ error: 'Text extraction is unreachable right now.' }, 502, headers);
    }

    if (!upstream.ok) {
      // Pass Anthropic's own message through (it never contains the key) so failures are diagnosable.
      const detail = (await upstream.text().catch(() => '')).slice(0, 300);
      return json({ error: `Anthropic returned ${upstream.status}: ${detail}` }, 502, headers);
    }

    const data = await upstream.json();
    const text = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
    return json({ text }, 200, headers);
  }
};
