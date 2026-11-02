// Cloudflare Worker for the site's Tools section.
// - Reads one photo and returns its text (Claude), narrates text through the home voice server (Kokoro),
//   and suggests file names (Claude).
// - Every AI and voice request needs a GitHub sign-in. Only accounts on the allowed list may use them.
// Secrets (never in this file): ANTHROPIC_API_KEY, KOKORO_TOKEN, GITHUB_CLIENT_SECRET, SESSION_SECRET.
// Variables (wrangler.toml): KOKORO_URL, GITHUB_CLIENT_ID, OWNER_LOGIN.
// KV binding USERS holds the allowed list under the key "allowed", as a JSON array of GitHub usernames.

const ALLOWED_ORIGINS = ['https://mshadkhah.github.io', 'http://127.0.0.1:8001'];
const MAX_BODY_CHARS = 8_000_000; // base64 JPEG; the reader sends roughly 1-3 MB
const SESSION_SECONDS = 7 * 24 * 3600;
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
const NAME_PROMPT = [
  'This is text from a book, and the photo may show the page with its page number.',
  'Suggest a short file name for an audio recording of this text.',
  'Include the author\'s last name, a short title, and the page number(s) if you can read them in the photo.',
  'Example: Goeman_Gendered-Geographies_p542-543.',
  'Use only letters, digits, hyphens, and underscores. Reply with JSON only, like {"name": "..."}.'
].join(' ');

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// ---- Sign-in tokens: payload and HMAC signature, both base64url, no cookies needed ----
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(text) {
  let base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signPayload(payload, secret) {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return body + '.' + toBase64Url(signature);
}
async function verifyPayload(token, secret) {
  if (typeof token !== 'string' || !secret) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), encoder.encode(body));
  if (!valid) return null;
  const payload = JSON.parse(decoder.decode(fromBase64Url(body)));
  if (!payload.exp || payload.exp < Date.now() / 1000) return null;
  return payload;
}

// ---- Allowed list (KV) ----
function ownerLogin(env) {
  return (env.OWNER_LOGIN || 'mshadkhah').toLowerCase();
}
async function allowedLogins(env) {
  let list = [];
  if (env.USERS) {
    try { list = JSON.parse((await env.USERS.get('allowed')) || '[]'); } catch (error) { list = []; }
  }
  return new Set([...list.map(name => String(name).toLowerCase()), ownerLogin(env)]);
}
async function currentUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const payload = await verifyPayload(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.SESSION_SECRET);
  if (!payload || !payload.login) return null;
  const allowed = await allowedLogins(env);
  return allowed.has(payload.login.toLowerCase()) ? payload.login : null;
}

// ---- GitHub sign-in ----
function isAllowedReturn(address) {
  try { return ALLOWED_ORIGINS.includes(new URL(address).origin); } catch (error) { return false; }
}
async function handleAuth(url, request, env, headers) {
  const callback = url.origin + '/auth/callback';
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) {
    return json({ error: 'Sign-in is not set up yet: GitHub client ID, GitHub client secret, and session secret are required.' }, 500, headers);
  }

  if (url.pathname === '/auth/login') {
    const returnTo = url.searchParams.get('return') || '';
    if (!isAllowedReturn(returnTo)) return json({ error: 'Return address not allowed' }, 400, headers);
    const state = await signPayload({ ret: returnTo, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
    const github = new URL('https://github.com/login/oauth/authorize');
    github.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    github.searchParams.set('redirect_uri', callback);
    github.searchParams.set('scope', 'read:user');
    github.searchParams.set('state', state);
    return Response.redirect(github.toString(), 302);
  }

  if (url.pathname === '/auth/callback') {
    const state = await verifyPayload(url.searchParams.get('state'), env.SESSION_SECRET);
    if (!state || !isAllowedReturn(state.ret)) return new Response('Sign-in expired. Go back to the site and try again.', { status: 400 });
    const back = new URL(state.ret);
    const fail = reason => { back.hash = 'error=' + reason; return Response.redirect(back.toString(), 302); };

    const code = url.searchParams.get('code');
    if (!code) return fail('no_code');
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: callback })
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenData.access_token) return fail('github_failed');

    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token, 'User-Agent': 'mshadkhah-tools', Accept: 'application/vnd.github+json' }
    });
    const user = await userResponse.json().catch(() => ({}));
    if (!user.login) return fail('github_failed');

    const allowed = await allowedLogins(env);
    if (!allowed.has(user.login.toLowerCase())) return fail('not_allowed');

    back.hash = 'session=' + await signPayload({ login: user.login, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }, env.SESSION_SECRET);
    return Response.redirect(back.toString(), 302);
  }

  if (url.pathname === '/auth/me') {
    const login = await currentUser(request, env);
    if (!login) return json({ error: 'Not signed in' }, 401, headers);
    return json({ login, owner: login.toLowerCase() === ownerLogin(env) }, 200, headers);
  }

  return json({ error: 'Not found' }, 404, headers);
}

// ---- Tool endpoints ----
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

async function handleText(request, env, headers) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.image !== 'string' || !body.image.length) return json({ error: 'Missing image' }, 400, headers);
  if (body.image.length > MAX_BODY_CHARS) return json({ error: 'Image is too large' }, 413, headers);

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
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

// ---- Access management (owner only) ----
async function readList(env) {
  if (!env.USERS) return [];
  try {
    const list = JSON.parse((await env.USERS.get('allowed')) || '[]');
    return [...new Set(list.map(name => String(name).toLowerCase()))];
  } catch (error) { return []; }
}
const VALID_LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

async function handleAdmin(request, env, headers) {
  const login = await currentUser(request, env);
  if (!login || login.toLowerCase() !== ownerLogin(env)) return json({ error: 'Only the owner can manage access.' }, 403, headers);

  const list = await readList(env);
  if (request.method === 'GET') return json({ users: list }, 200, headers);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Missing request body' }, 400, headers);
  let next = [...list];
  if (body.add) {
    const name = String(body.add).trim().toLowerCase();
    if (!VALID_LOGIN.test(name)) return json({ error: 'That is not a valid GitHub username.' }, 400, headers);
    if (!next.includes(name)) next.push(name);
  }
  if (body.remove) {
    const name = String(body.remove).trim().toLowerCase();
    next = next.filter(item => item !== name);
  }
  if (!env.USERS) return json({ error: 'The access list is not set up yet.' }, 500, headers);
  await env.USERS.put('allowed', JSON.stringify(next));
  return json({ users: next }, 200, headers);
}

async function route(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname.startsWith('/auth/') && request.method === 'GET') return handleAuth(url, request, env, headers);
    if (url.pathname === '/admin/users' && (request.method === 'GET' || request.method === 'POST')) {
      if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Origin not allowed' }, 403, headers);
      return handleAdmin(request, env, headers);
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Origin not allowed' }, 403, headers);

    const login = await currentUser(request, env);
    if (!login) return json({ error: 'Sign in with GitHub to use this tool.' }, 401, headers);

    if (url.pathname === '/speak') return handleSpeak(request, env, headers);
    if (url.pathname === '/name') return handleName(request, env, headers);
    return handleText(request, env, headers);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      return json({ error: 'Tools service error: ' + error.message }, 500, corsHeaders(request.headers.get('Origin') || ''));
    }
  }
};
