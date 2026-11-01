// Cloudflare Worker: receives one photo from the reader, asks Claude for its text, and returns only that text.
// The Anthropic key is stored as a Worker secret (ANTHROPIC_API_KEY) and never reaches the browser.
// Photos are forwarded to Anthropic and are not written to storage by this Worker.

const ALLOWED_ORIGINS = ['https://mshadkhah.github.io', 'http://127.0.0.1:8001'];
const MAX_BODY_CHARS = 8_000_000; // base64 JPEG; the reader sends roughly 1-3 MB
const PROMPT = [
  'This photo may show an open book with two pages. Transcribe only the main page in the foreground, usually the one with the title or the most centered block of text.',
  'Output only the transcribed text, keeping paragraph breaks.',
  'Join words split by a hyphen at the end of a line (for example "Sen-" plus "eca" becomes "Seneca").',
  'Do not add commentary, descriptions, translations, or markdown.',
  'If there is no readable text, output nothing.'
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Origin not allowed' }, 403, headers);

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
          max_tokens: 2000,
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

    if (!upstream.ok) return json({ error: 'Text extraction service returned an error.' }, 502, headers);

    const data = await upstream.json();
    const text = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
    return json({ text }, 200, headers);
  }
};
