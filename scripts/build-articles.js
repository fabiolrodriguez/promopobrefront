const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const matter = require('gray-matter');
const { generateArticleSchema, renderSchemas } = require('./schema');

const ROOT        = path.join(__dirname, '..');
const ARTIGOS_DIR = path.join(ROOT, 'artigos');
const TEMPLATE    = fs.readFileSync(path.join(__dirname, 'article-template.html'), 'utf8');
const BASE_URL    = 'https://promopobre.com.br';

const CATEGORIES = [
  { slug: 'casa',        label: 'Casa',        keywords: ['air fryer', 'ergonômic', 'aspirador', 'extratora', 'geladeira', 'fogão', 'microondas', 'ventilador', 'ar condicionado', 'eletrodoméstic', 'panela', 'sofá', 'limpeza doméstic'] },
  { slug: 'ferramentas', label: 'Ferramentas', keywords: ['ferramenta', 'furadeira', 'parafusadeira', 'serra', 'martelo', 'alicate', 'broca', 'chave de fenda'] },
  { slug: 'games',       label: 'Games',       keywords: ['console portátil', 'playstation', 'xbox', 'nintendo switch', 'ps4', 'ps5', 'videogame', 'gamer', 'portátil retrô', 'emulador', 'r36s', 'trimui'] },
  { slug: 'smartphones', label: 'Smartphones', keywords: ['smartphone', 'celular', 'iphone', 'moto g', 'motorola', 'android', 'poco', 'galaxy a', 'galaxy m', 'galaxy s', ' realme ', 'redmi note'] },
  { slug: 'tablets',     label: 'Tablets',     keywords: ['tablet', 'ipad', 'kindle', 'galaxy tab', 'redmi pad', 'lenovo tab', 'tab a9', 'tab a8'] },
  { slug: 'tecnologia',  label: 'Tecnologia',  keywords: ['notebook', 'laptop', 'ideapad', 'processador', 'gpu', 'smart tv', 'televisão', ' tvs ', 'melhores tvs', 'streaming', 'home office', 'mochila para notebook'] },
];

function categorizeArticle(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  return CATEGORIES.filter(cat => cat.keywords.some(kw => text.includes(kw))).map(cat => cat.slug);
}

marked.setOptions({ gfm: true, breaks: false });

const AFFILIATE_DOMAINS = [
  'amzn.to', 'amazon.com.br', 'amazon.com',
  'mercadolivre.com', 'mercadolibre.com',
  'shopee.com.br',
  'aliexpress.com',
  'magazineluiza.com.br', 'magalu.com',
  'kabum.com.br',
  'casasbahia.com.br', 'extra.com.br', 'pontofrio.com.br',
  'americanas.com.br', 'americanas.com',
  'submarino.com.br',
];

function processLinks(html) {
  return html.replace(/<a\s+href="([^"]+)"/g, (match, href) => {
    try {
      const hostname = new URL(href).hostname.replace(/^www\./, '');
      const affiliate = AFFILIATE_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
      const rel = affiliate ? 'sponsored noopener' : 'noopener noreferrer';
      return `<a href="${href}" rel="${rel}" target="_blank"`;
    } catch {
      return match; // link relativo, nao mexe
    }
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const files = fs.readdirSync(ARTIGOS_DIR).filter(f => f.endsWith('.md'));

const today = new Date().toISOString().split('T')[0];

// Promove artigos agendados que chegaram ao prazo
const rascunhosPath = path.join(ROOT, 'artigos_rascunhos.json');
const artigosPath   = path.join(ROOT, 'artigos.json');
let rascunhos = [];
try { rascunhos = JSON.parse(fs.readFileSync(rascunhosPath, 'utf8')); } catch {}

const devemPublicar = rascunhos.filter(r => r.publish_date <= today);
if (devemPublicar.length > 0) {
  let artigos = [];
  try { artigos = JSON.parse(fs.readFileSync(artigosPath, 'utf8')); } catch {}
  for (const r of devemPublicar) {
    if (!artigos.find(a => a.slug === r.slug)) {
      artigos.unshift({ slug: r.slug, title: r.title, description: r.description, date: r.publish_date, image: r.image });
    }
  }
  const restantes = rascunhos.filter(r => r.publish_date > today);
  fs.writeFileSync(artigosPath,   JSON.stringify(artigos,   null, 2) + '\n');
  fs.writeFileSync(rascunhosPath, JSON.stringify(restantes, null, 2) + '\n');
  console.log(`Publicados automaticamente: ${devemPublicar.map(r => r.slug).join(', ')}`);
}

if (files.length === 0) {
  console.log('Nenhum artigo .md encontrado. Gerando sitemap apenas com URLs estaticas.');
}

// Remove HTML directories that no longer have a .md source
const slugsWithMd = new Set(files.map(f => f.replace('.md', '')));
for (const entry of fs.readdirSync(ARTIGOS_DIR)) {
  if (entry === 'categoria') continue;
  const full = path.join(ARTIGOS_DIR, entry);
  if (fs.statSync(full).isDirectory() && !slugsWithMd.has(entry)) {
    fs.rmSync(full, { recursive: true });
    console.log(`Removido: ${entry}/`);
  }
}

// Stop words PT-BR
const STOP_WORDS = new Set(['de','do','da','dos','das','em','no','na','nos','nas','para','com','por','um','uma','uns','umas','os','as','que','e','o','a','se','ao','aos','mais','mas','ou','foi','ser','ter','tem','está','são','este','esta','isso','esse','essa']);

function tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-záéíóúâêîôûãõç\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

function findRelated(currentSlug, currentData, allArticles, limit = 5) {
  const currentTokens = new Set(tokenize(`${currentData.title} ${currentData.description || ''}`));
  const scored = allArticles
    .filter(a => a.slug !== currentSlug)
    .map(a => {
      const tokens = tokenize(`${a.data.title} ${a.data.description || ''}`);
      let score = tokens.filter(t => currentTokens.has(t)).length;
      if (a.data.type && a.data.type === currentData.type) score += 2;
      return { ...a, score };
    })
    .sort((a, b) =>
      b.score - a.score ||
      (b.data.publish_date || b.data.date || '').localeCompare(a.data.publish_date || a.data.date || '')
    )
    .slice(0, limit);

  // Completa com mais recentes se não atingiu o limite
  if (scored.length < limit) {
    const seen = new Set([currentSlug, ...scored.map(a => a.slug)]);
    const recent = allArticles
      .filter(a => !seen.has(a.slug))
      .sort((a, b) => (b.data.publish_date || b.data.date || '').localeCompare(a.data.publish_date || a.data.date || ''))
      .slice(0, limit - scored.length);
    scored.push(...recent);
  }
  return scored;
}

function renderRelated(articles) {
  if (!articles.length) return '';
  return `<section class="related-articles">
  <h2>Artigos Relacionados</h2>
  <div class="related-grid">
    ${articles.map(a => `<a href="/artigos/${a.slug}/" class="related-card">
      ${a.data.image
        ? `<img src="${a.data.image}" alt="${(a.data.title || '').replace(/"/g, '&quot;')}" loading="lazy">`
        : '<div class="related-no-img">📝</div>'}
      <div class="related-info">
        <span class="related-title">${a.data.title || a.slug}</span>
        <span class="related-date">${formatDate(a.data.publish_date || a.data.date)}</span>
      </div>
    </a>`).join('')}
  </div>
</section>`;
}

// Passo 1: coleta todos os artigos publicados
const allArticles = [];
const articlesByCategory = {};
CATEGORIES.forEach(c => { articlesByCategory[c.slug] = []; });

for (const file of files) {
  const slug = file.replace('.md', '');
  const src  = fs.readFileSync(path.join(ARTIGOS_DIR, file), 'utf8');
  const { data, content } = matter(src);
  const publishDate = data.publish_date || data.date || null;
  if (publishDate && publishDate > today) {
    console.log(`Pulando (agendado para ${publishDate}): ${slug}`);
    continue;
  }
  allArticles.push({ slug, data, content });
  const cats = categorizeArticle(data.title || '', data.description || '');
  for (const catSlug of cats) {
    if (articlesByCategory[catSlug]) {
      articlesByCategory[catSlug].push({ slug, title: data.title, description: data.description, date: data.publish_date || data.date || '', image: data.image || '' });
    }
  }
}

const articleUrls = [];

// Passo 2: builda cada artigo com acesso aos metadados de todos os outros
for (const { slug, data, content } of allArticles) {
  const html        = processLinks(marked(content));
  const related     = findRelated(slug, data, allArticles);
  const ogImage     = data.image ? `<meta property="og:image" content="${data.image}">` : '';
  const coverImage  = data.image ? `<img class="cover-image" src="${data.image}" alt="${(data.title || '').replace(/"/g, '&quot;')}">` : '';
  const schemaLd    = renderSchemas(generateArticleSchema(data, content, slug, today));

  const page = TEMPLATE
    .replace(/\{\{title\}\}/g,            data.title || slug)
    .replace(/\{\{description\}\}/g,      data.description || '')
    .replace(/\{\{date\}\}/g,             data.publish_date || data.date || '')
    .replace(/\{\{date_formatted\}\}/g,   formatDate(data.publish_date || data.date))
    .replace(/\{\{image\}\}/g,            data.image || '')
    .replace(/\{\{slug\}\}/g,             slug)
    .replace(/\{\{og_image\}\}/g,         ogImage)
    .replace(/\{\{cover_image\}\}/g,      coverImage)
    .replace(/\{\{schema_ld\}\}/g,        schemaLd)
    .replace(/\{\{related_articles\}\}/g, renderRelated(related))
    .replace(/\{\{content\}\}/g,          html);

  const outDir = path.join(ARTIGOS_DIR, slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), page);
  console.log(`Gerado: artigos/${slug}/index.html`);

  articleUrls.push({ slug, date: data.publish_date || data.date || '' });
}

// Gera páginas de categoria
const CAT_DIR = path.join(ARTIGOS_DIR, 'categoria');
fs.mkdirSync(CAT_DIR, { recursive: true });

// Remove diretórios de categoria que não existem mais
for (const entry of fs.readdirSync(CAT_DIR)) {
  const full = path.join(CAT_DIR, entry);
  if (fs.statSync(full).isDirectory() && !CATEGORIES.find(c => c.slug === entry)) {
    fs.rmSync(full, { recursive: true });
    console.log(`Categoria removida: ${entry}/`);
  }
}

const categoryEntries = [];

for (const cat of CATEGORIES) {
  const articles = articlesByCategory[cat.slug];
  if (!articles.length) continue;

  const outDir = path.join(CAT_DIR, cat.slug);
  fs.mkdirSync(outDir, { recursive: true });

  const catNavLinks = CATEGORIES
    .filter(c => articlesByCategory[c.slug].length > 0)
    .map(c => `<a href="/artigos/categoria/${c.slug}/" class="cat-chip${c.slug === cat.slug ? ' active' : ''}">${c.label}</a>`)
    .join('');

  const cards = articles
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map(a => `
        <a class="article-card" href="/artigos/${a.slug}/">
          ${a.image
            ? `<img src="${a.image}" alt="${(a.title || '').replace(/"/g, '&quot;')}" loading="lazy">`
            : `<div class="no-img">📝</div>`}
          <div class="body">
            <h2>${a.title || a.slug}</h2>
            <p>${a.description || ''}</p>
            <div class="meta">${a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('pt-BR') : ''}</div>
          </div>
        </a>`).join('');

  const page = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${cat.label} - Artigos - Promopobre</title>
  <meta name="description" content="Artigos e reviews de ${cat.label.toLowerCase()} com melhor custo-benefício. Análises completas antes de comprar.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${BASE_URL}/artigos/categoria/${cat.slug}/">
  <link rel="icon" type="image/png" href="/icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700;800&display=swap" rel="stylesheet">
  <meta property="og:type"        content="website">
  <meta property="og:url"         content="${BASE_URL}/artigos/categoria/${cat.slug}/">
  <meta property="og:title"       content="${cat.label} - Artigos - Promopobre">
  <meta property="og:description" content="Artigos e reviews de ${cat.label.toLowerCase()} com melhor custo-benefício.">
  <meta property="og:locale"      content="pt_BR">
  <link rel="stylesheet" href="/shared.css">
  <style>
    main { max-width: 780px; margin: 0 auto; padding: 2rem 1rem 4rem; }
    .breadcrumb { font-size: 0.8rem; color: var(--muted); margin-bottom: 1.5rem; }
    .breadcrumb a { color: var(--muted); text-decoration: none; }
    .breadcrumb a:hover { color: var(--text); }
    .cat-nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.75rem; }
    .cat-chip { font-size: 0.8rem; font-weight: 600; padding: 5px 14px; border-radius: 20px; text-decoration: none; background: var(--card); border: 1px solid var(--border); color: var(--muted); transition: all .15s; }
    .cat-chip:hover { border-color: #FFD600; color: var(--text); }
    .cat-chip.active { background: #FFD600; border-color: #FFD600; color: #111; }
    #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.25rem; }
    .article-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; text-decoration: none; color: var(--text); display: flex; flex-direction: column; transition: box-shadow .15s; }
    .article-card:hover { box-shadow: 0 4px 20px rgba(255, 214, 0, 0.15); }
    .article-card img { width: 100%; height: 180px; object-fit: cover; background: var(--bg); }
    .article-card .no-img { width: 100%; height: 180px; background: var(--bg); display: flex; align-items: center; justify-content: center; font-size: 2.5rem; }
    .article-card .body { padding: 1rem; flex: 1; display: flex; flex-direction: column; }
    .article-card h2 { font-size: 1rem; font-weight: 700; line-height: 1.4; margin-bottom: 0.4rem; }
    .article-card p { font-size: 0.85rem; color: var(--muted); line-height: 1.5; flex: 1; }
    .article-card .meta { margin-top: 0.75rem; font-size: 0.75rem; color: var(--muted); }
  </style>
</head>
<body>
<header>
  <a href="/"><h1><img src="/icon.png" alt="" width="52" height="52" style="vertical-align:middle;margin-right:12px;border-radius:10px">Promo<span style="color:#FFD600">pobre</span></h1></a>
  <p>As melhores ofertas selecionadas para voce</p>
  <nav style="margin-top:1rem;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
    <a href="/artigos/" style="color:#fff;font-size:0.85rem;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,0.3);border-radius:20px;padding:5px 16px;opacity:0.85">Artigos</a>
    <a href="/contato/" style="color:#fff;font-size:0.85rem;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,0.3);border-radius:20px;padding:5px 16px;opacity:0.85">Contato</a>
  </nav>
</header>
<main>
  <div class="breadcrumb"><a href="/">Home</a> › <a href="/artigos/">Artigos</a> › ${cat.label}</div>
  <div class="cat-nav">
    <a href="/artigos/" class="cat-chip">Todos</a>
    ${catNavLinks}
  </div>
  <div id="grid">${cards}</div>
</main>
<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "bf2c3cefe2e948b78acb9d838b024a4e"}'></script><!-- End Cloudflare Web Analytics -->
</body>
</html>`;

  fs.writeFileSync(path.join(outDir, 'index.html'), page);
  console.log(`Gerado: artigos/categoria/${cat.slug}/index.html (${articles.length} artigo(s))`);
  categoryEntries.push({ loc: `${BASE_URL}/artigos/categoria/${cat.slug}/`, lastmod: today, priority: '0.6', changefreq: 'weekly' });
}

// Gera sitemap.xml

const staticUrls = [
  { loc: `${BASE_URL}/`,         priority: '1.0', changefreq: 'daily'   },
  { loc: `${BASE_URL}/artigos/`, priority: '0.8', changefreq: 'weekly'  },
];

const articleEntries = articleUrls.map(({ slug, date }) => ({
  loc:        `${BASE_URL}/artigos/${slug}/`,
  lastmod:    date || today,
  priority:   '0.7',
  changefreq: 'monthly',
}));

// Inclui páginas de produto geradas por build-products.js
const PRODUTOS_DIR = path.join(ROOT, 'produtos');
const productEntries = [];
if (fs.existsSync(PRODUTOS_DIR)) {
  for (const entry of fs.readdirSync(PRODUTOS_DIR)) {
    const metaPath = path.join(PRODUTOS_DIR, entry, 'meta.json');
    if (fs.existsSync(metaPath)) {
      productEntries.push({
        loc:        `${BASE_URL}/produtos/${entry}/`,
        lastmod:    today,
        priority:   '0.6',
        changefreq: 'weekly',
      });
    }
  }
}

const allUrls = [...staticUrls, ...articleEntries, ...categoryEntries, ...productEntries];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);
console.log(`Gerado: sitemap.xml (${allUrls.length} URLs)`);
