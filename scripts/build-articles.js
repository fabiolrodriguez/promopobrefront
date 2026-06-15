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

const articleUrls = [];

for (const file of files) {
  const slug = file.replace('.md', '');
  const src  = fs.readFileSync(path.join(ARTIGOS_DIR, file), 'utf8');
  const { data, content } = matter(src);

  const publishDate = data.publish_date || data.date || null;
  if (publishDate && publishDate > today) {
    console.log(`Pulando (agendado para ${publishDate}): ${slug}`);
    continue;
  }

  const html = processLinks(marked(content));

  const ogImage = data.image
    ? `<meta property="og:image" content="${data.image}">`
    : '';

  const coverImage = data.image
    ? `<img class="cover-image" src="${data.image}" alt="${data.title || ''}">`
    : '';

  const schemaLd = renderSchemas(generateArticleSchema(data, content, slug, today));

  const page = TEMPLATE
    .replace(/\{\{title\}\}/g,          data.title || slug)
    .replace(/\{\{description\}\}/g,    data.description || '')
    .replace(/\{\{date\}\}/g,           data.publish_date || data.date || '')
    .replace(/\{\{date_formatted\}\}/g, formatDate(data.publish_date || data.date))
    .replace(/\{\{image\}\}/g,          data.image || '')
    .replace(/\{\{slug\}\}/g,           slug)
    .replace(/\{\{og_image\}\}/g,       ogImage)
    .replace(/\{\{cover_image\}\}/g,    coverImage)
    .replace(/\{\{schema_ld\}\}/g,      schemaLd)
    .replace(/\{\{content\}\}/g,        html);

  const outDir = path.join(ARTIGOS_DIR, slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), page);
  console.log(`Gerado: artigos/${slug}/index.html`);

  articleUrls.push({ slug, date: data.date || '' });
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
