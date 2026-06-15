const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const matter = require('gray-matter');
const { generateArticleSchema, renderSchemas } = require('./schema');

const ROOT        = path.join(__dirname, '..');
const ARTIGOS_DIR = path.join(ROOT, 'artigos');
const TEMPLATE    = fs.readFileSync(path.join(__dirname, 'article-template.html'), 'utf8');
const BASE_URL    = 'https://promopobre.com.br';

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

const allUrls = [...staticUrls, ...articleEntries];

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
