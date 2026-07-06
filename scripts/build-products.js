const fs   = require('fs');
const path = require('path');

const ROOT         = path.join(__dirname, '..');
const PRODUTOS_DIR = path.join(ROOT, 'produtos');
const LINKS_FILE   = path.join(ROOT, 'links.json');
const TEMPLATE     = fs.readFileSync(path.join(__dirname, 'product-template.html'), 'utf8');

let articles = [];
try { articles = JSON.parse(fs.readFileSync(path.join(ROOT, 'artigos.json'), 'utf8')); } catch {}

const STOP_WORDS = new Set(['de','do','da','dos','das','em','no','na','nos','nas','para','com','por','um','uma','os','as','o','a','e','ou','ao','que','se','mais','vs','the','and','for']);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function score(aTokens, bText) {
  const bSet = new Set(tokenize(bText));
  return aTokens.filter(t => bSet.has(t)).length;
}

function findRelatedArticle(titulo) {
  const tokens = tokenize(titulo);
  if (!tokens.length) return null;
  let best = null, bestScore = 0;
  for (const a of articles) {
    const s = score(tokens, a.title + ' ' + (a.description || ''));
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return bestScore >= 2 ? best : null;
}

function findSimilarProducts(current, all, n = 3) {
  const tokens = tokenize(current.titulo);
  if (!tokens.length) return [];
  return all
    .filter(p => p.titulo !== current.titulo)
    .map(p => ({ p, s: score(tokens, p.titulo) }))
    .filter(({ s }) => s >= 1)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(({ p }) => p);
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toSlug(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-$/, '')
    .substring(0, 80);
}

function hostname(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return url; }
}

const FRIENDLY_HOSTS = {
  'link.amazon':          'Amazon',
  's.shopee.com.br':      'Shopee',
  's.click.aliexpress.com': 'AliExpress',
  'go.magalu.com':        'Magazine Luiza',
};

function friendlyHost(url) {
  const h = hostname(url);
  return FRIENDLY_HOSTS[h] || h;
}

function brl(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildPage(data) {
  return TEMPLATE
    .replace(/\{\{titulo\}\}/g,           esc(data.titulo))
    .replace(/\{\{loja\}\}/g,             esc(data.loja))
    .replace(/\{\{slug\}\}/g,             data.slug)
    .replace(/\{\{imagem\}\}/g,           esc(data.imagem))
    .replace(/\{\{preco_html\}\}/g,       data.preco_html)
    .replace(/\{\{badge_html\}\}/g,       data.badge_html)
    .replace(/\{\{obs_html\}\}/g,         data.obs_html)
    .replace(/\{\{coupon_html\}\}/g,      data.coupon_html)
    .replace(/\{\{expired_banner\}\}/g,   data.expired_banner)
    .replace(/\{\{offer_cta\}\}/g,        data.offer_cta)
    .replace(/\{\{volta_cta\}\}/g,        data.volta_cta)
    .replace(/\{\{produto_class\}\}/g,    data.produto_class)
    .replace(/\{\{schema_json\}\}/g,      data.schema_json)
    .replace(/\{\{related_article\}\}/g,  data.related_article)
    .replace(/\{\{similar_products\}\}/g, data.similar_products);
}

// Read links.json
let links = [];
try { links = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8')); } catch (e) {
  console.error('Erro ao ler links.json:', e.message);
  process.exit(1);
}

// Normalize entries (support both string and object formats)
const products = links
  .map(e => typeof e === 'string' ? { url: e } : e)
  .filter(e => e && e.url)
  .map(e => ({
    titulo:       e.title  || e.titulo || friendlyHost(e.url),
    loja:         e.loja   || friendlyHost(e.url),
    link:         e.url,
    imagem:       e.image  || e.imagem || '',
    preco:        e.price  != null ? e.price  : (e.preco  != null ? e.preco  : null),
    preco_original: e.preco_original || null,
    desconto_pct:   e.desconto_pct   || null,
    coupon:         e.coupon         || null,
    obs:            e.obs            || null,
  }))
  .filter(p => p.titulo);

fs.mkdirSync(PRODUTOS_DIR, { recursive: true });

const activeSlugs = new Set();

// Build active product pages
for (const p of products) {
  const slug = toSlug(p.titulo);
  if (!slug) continue;
  activeSlugs.add(slug);

  const outDir = path.join(PRODUTOS_DIR, slug);
  fs.mkdirSync(outDir, { recursive: true });

  // Tombstone: survives deletion from links.json so we can build the expired page
  fs.writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify({ titulo: p.titulo, imagem: p.imagem, loja: p.loja, slug }, null, 2) + '\n'
  );

  const precoHtml = p.preco != null
    ? (p.preco_original ? `<p class="preco-original">${brl(p.preco_original)}</p>` : '') +
      `<p class="preco-atual">${brl(p.preco)}</p>`
    : '';

  const badgeHtml = p.desconto_pct
    ? `<span class="badge-desconto">-${p.desconto_pct}%</span>`
    : '';

  const obsHtml = p.obs
    ? `<p class="produto-obs">${esc(p.obs)}</p>`
    : '';

  const couponHtml = p.coupon
    ? `<div class="produto-cupom" onclick="copiarCupom(this,'${esc(p.coupon)}')" title="Clique para copiar o cupom">CUPOM: <strong>${esc(p.coupon)}</strong></div>`
    : '';

  const schemaObj = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.titulo,
    image: p.imagem,
    offers: {
      '@type': 'Offer',
      ...(p.preco != null ? { price: String(p.preco), priceCurrency: 'BRL' } : {}),
      availability: 'https://schema.org/InStock',
      url: p.link,
      seller: { '@type': 'Organization', name: p.loja },
    },
  };

  const relatedArticle = findRelatedArticle(p.titulo);
  const relatedArticleHtml = relatedArticle
    ? `<h2 class="section-heading">Artigo relacionado</h2>
<a class="related-article-link" href="/artigos/${relatedArticle.slug}/">
  ${relatedArticle.image ? `<img src="${esc(relatedArticle.image)}" alt="${esc(relatedArticle.title)}" loading="lazy">` : ''}
  <div class="art-info">
    <span class="art-label">Leitura recomendada</span>
    <p class="art-title">${esc(relatedArticle.title)}</p>
  </div>
</a>`
    : '';

  const similar = findSimilarProducts(p, products);
  const similarHtml = similar.length
    ? `<h2 class="section-heading">Produtos similares</h2>
<div class="similar-grid">
  ${similar.map(s => {
    const sSlug = toSlug(s.titulo);
    return `<a class="similar-card" href="/produtos/${sSlug}/">
    <img src="${esc(s.imagem)}" alt="${esc(s.titulo)}" loading="lazy" onerror="this.style.display='none'">
    <div class="sim-body">
      <span class="sim-title">${esc(s.titulo)}</span>
      ${s.preco != null ? `<span class="sim-price">${brl(s.preco)}</span>` : ''}
    </div>
  </a>`;
  }).join('\n  ')}
</div>`
    : '';

  const page = buildPage({
    titulo:           p.titulo,
    loja:             p.loja,
    slug,
    imagem:           p.imagem,
    preco_html:       precoHtml,
    badge_html:       badgeHtml,
    obs_html:         obsHtml,
    coupon_html:      couponHtml,
    expired_banner:   '',
    offer_cta:        `<a class="btn-oferta" href="${esc(p.link)}" target="_blank" rel="sponsored noopener">Ver oferta na ${esc(p.loja)} &rarr;</a>`,
    volta_cta:        '<a class="btn-voltar" href="/">&larr; Voltar &agrave;s ofertas</a>',
    produto_class:    '',
    schema_json:      `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`,
    related_article:  relatedArticleHtml,
    similar_products: similarHtml,
  });

  fs.writeFileSync(path.join(outDir, 'index.html'), page);
  console.log(`Gerado: produtos/${slug}/index.html`);
}

// Mark orphaned pages as expired
for (const entry of fs.readdirSync(PRODUTOS_DIR)) {
  const full = path.join(PRODUTOS_DIR, entry);
  if (!fs.statSync(full).isDirectory()) continue;
  if (activeSlugs.has(entry)) continue;

  const metaPath = path.join(full, 'meta.json');
  if (!fs.existsSync(metaPath)) continue;

  // Skip if already expired (idempotent)
  const htmlPath = path.join(full, 'index.html');
  if (fs.existsSync(htmlPath) && fs.readFileSync(htmlPath, 'utf8').includes('>OFERTA EXPIRADA<')) {
    console.log(`Já expirado: produtos/${entry}/index.html`);
    continue;
  }

  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { continue; }

  const schemaObj = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: meta.titulo,
    image: meta.imagem || '',
    offers: { '@type': 'Offer', availability: 'https://schema.org/Discontinued' },
  };

  const page = buildPage({
    titulo:         meta.titulo,
    loja:           meta.loja || '',
    slug:           entry,
    imagem:         meta.imagem || '',
    preco_html:     '',
    badge_html:     '',
    obs_html:         '',
    coupon_html:      '',
    expired_banner:   '<div class="oferta-expirada-banner">OFERTA EXPIRADA</div>',
    offer_cta:        '',
    volta_cta:        '<a class="btn-voltar" href="/">Ver ofertas ativas &rarr;</a>',
    produto_class:    'expirado',
    schema_json:      `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`,
    related_article:  '',
    similar_products: '',
  });

  fs.writeFileSync(htmlPath, page);
  console.log(`Marcado como expirado: produtos/${entry}/index.html`);
}

console.log(`Concluído: ${activeSlugs.size} produto(s) ativo(s).`);
