// Promopobre Admin Worker
// Deploy: cole este codigo no dashboard Cloudflare Workers
// Env vars necessarias: ADMIN_USER, ADMIN_PASS, JWT_SECRET, GITHUB_PAT

const REPO = 'fabiolrodriguez/promopobrefront';
const FILE = 'links.json';

// --- Base64 unicode-safe ---

function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decodeBase64(str) {
  const bin = atob(str.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// --- JWT HS256 via Web Crypto ---

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

async function jwtSign(payload, secret) {
  const enc = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

async function jwtVerify(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(b64urlDecode(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(b64urlDecode(body));
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- GitHub API ---

async function ghGet(pat) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'promopobre-admin'
    }
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = await res.json();
  return { links: JSON.parse(decodeBase64(data.content)), sha: data.sha };
}

async function ghPut(pat, links, sha, message) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'promopobre-admin',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      content: encodeBase64(JSON.stringify(links, null, 2) + '\n'),
      sha
    })
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
}

// --- Helpers ---

function getUrl(item) {
  return typeof item === 'string' ? item : item.url;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function withCors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(res.body, { status: res.status, headers: h });
}

// --- Handlers ---

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  if (username !== env.ADMIN_USER || password !== env.ADMIN_PASS) {
    return json({ error: 'Credenciais invalidas' }, 401);
  }
  const token = await jwtSign(
    { sub: username, exp: Math.floor(Date.now() / 1000) + 86400 },
    env.JWT_SECRET
  );
  return json({ token });
}

async function handleGetProducts(env) {
  const { links } = await ghGet(env.GITHUB_PAT);
  return json(links);
}

async function handleAddProduct(request, env) {
  const product = await request.json();
  if (!product.url || !product.title || !product.image) {
    return json({ error: 'url, title e image sao obrigatorios' }, 400);
  }
  const { links, sha } = await ghGet(env.GITHUB_PAT);
  if (links.some(l => getUrl(l) === product.url)) {
    return json({ error: 'URL ja existe' }, 409);
  }
  links.unshift({ url: product.url, title: product.title, image: product.image });
  await ghPut(env.GITHUB_PAT, links, sha, `admin: adiciona "${product.title}"`);
  return json({ ok: true });
}

async function handleDeleteProduct(request, env) {
  const { url } = await request.json();
  if (!url) return json({ error: 'url obrigatoria' }, 400);
  const { links, sha } = await ghGet(env.GITHUB_PAT);
  const filtered = links.filter(l => getUrl(l) !== url);
  if (filtered.length === links.length) return json({ error: 'Produto nao encontrado' }, 404);
  await ghPut(env.GITHUB_PAT, filtered, sha, `admin: remove ${url}`);
  return json({ ok: true });
}

// --- Main ---

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    if (url.pathname === '/login' && request.method === 'POST') {
      return withCors(
        await handleLogin(request, env).catch(e => json({ error: e.message }, 500))
      );
    }

    const authHeader = request.headers.get('Authorization') || '';
    const payload = await jwtVerify(authHeader.replace('Bearer ', ''), env.JWT_SECRET);
    if (!payload) return withCors(json({ error: 'Unauthorized' }, 401));

    try {
      if (url.pathname === '/products') {
        if (request.method === 'GET')    return withCors(await handleGetProducts(env));
        if (request.method === 'POST')   return withCors(await handleAddProduct(request, env));
        if (request.method === 'DELETE') return withCors(await handleDeleteProduct(request, env));
      }
    } catch (e) {
      return withCors(json({ error: e.message }, 500));
    }

    return withCors(new Response('Not Found', { status: 404 }));
  }
};
