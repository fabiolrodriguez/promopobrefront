const fs   = require('fs');
const path = require('path');

const ROOT         = path.join(__dirname, '..');
const PRODUTOS_DIR = path.join(ROOT, 'produtos');
const LINKS_FILE   = path.join(ROOT, 'links.json');
const TEMPLATE     = fs.readFileSync(path.join(__dirname, 'product-template.html'), 'utf8');

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
    .replace(/\{\{titulo\}\}/g,         esc(data.titulo))
    .replace(/\{\{loja\}\}/g,           esc(data.loja))
    .replace(/\{\{slug\}\}/g,           data.slug)
    .replace(/\{\{imagem\}\}/g,         esc(data.imagem))
    .replace(/\{\{preco_html\}\}/g,     data.preco_html)
    .replace(/\{\{badge_html\}\}/g,     data.badge_html)
    .replace(/\{\{coupon_html\}\}/g,    data.coupon_html)
    .replace(/\{\{expired_banner\}\}/g, data.expired_banner)
    .replace(/\{\{offer_cta\}\}/g,      data.offer_cta)
    .replace(/\{\{volta_cta\}\}/g,      data.volta_cta)
    .replace(/\{\{produto_class\}\}/g,  data.produto_class)
    .replace(/\{\{schema_json\}\}/g,    data.schema_json);
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

  const page = buildPage({
    titulo:         p.titulo,
    loja:           p.loja,
    slug,
    imagem:         p.imagem,
    preco_html:     precoHtml,
    badge_html:     badgeHtml,
    coupon_html:    couponHtml,
    expired_banner: '',
    offer_cta:      `<a class="btn-oferta" href="${esc(p.link)}" target="_blank" rel="sponsored noopener">Ver oferta na ${esc(p.loja)} &rarr;</a>`,
    volta_cta:      '<a class="btn-voltar" href="/">&larr; Voltar &agrave;s ofertas</a>',
    produto_class:  '',
    schema_json:    `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`,
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
    coupon_html:    '',
    expired_banner: '<div class="oferta-expirada-banner">OFERTA EXPIRADA</div>',
    offer_cta:      '',
    volta_cta:      '<a class="btn-voltar" href="/">Ver ofertas ativas &rarr;</a>',
    produto_class:  'expirado',
    schema_json:    `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`,
  });

  fs.writeFileSync(htmlPath, page);
  console.log(`Marcado como expirado: produtos/${entry}/index.html`);
}

console.log(`Concluído: ${activeSlugs.size} produto(s) ativo(s).`);
