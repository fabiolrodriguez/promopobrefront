const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const matter = require('gray-matter');

const ROOT = path.join(__dirname, '..');
const ARTIGOS_DIR = path.join(ROOT, 'artigos');
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'article-template.html'), 'utf8');

marked.setOptions({ gfm: true, breaks: false });

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const files = fs.readdirSync(ARTIGOS_DIR).filter(f => f.endsWith('.md'));

if (files.length === 0) {
  console.log('Nenhum artigo .md encontrado.');
  process.exit(0);
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

for (const file of files) {
  const slug = file.replace('.md', '');
  const src = fs.readFileSync(path.join(ARTIGOS_DIR, file), 'utf8');
  const { data, content } = matter(src);

  const html = marked(content);

  const ogImage = data.image
    ? `<meta property="og:image" content="${data.image}">`
    : '';

  const coverImage = data.image
    ? `<img class="cover-image" src="${data.image}" alt="${data.title || ''}">`
    : '';

  const page = TEMPLATE
    .replace(/\{\{title\}\}/g,          data.title || slug)
    .replace(/\{\{description\}\}/g,    data.description || '')
    .replace(/\{\{date\}\}/g,           data.date || '')
    .replace(/\{\{date_formatted\}\}/g, formatDate(data.date))
    .replace(/\{\{image\}\}/g,          data.image || '')
    .replace(/\{\{slug\}\}/g,           slug)
    .replace(/\{\{og_image\}\}/g,       ogImage)
    .replace(/\{\{cover_image\}\}/g,    coverImage)
    .replace(/\{\{content\}\}/g,        html);

  const outDir = path.join(ARTIGOS_DIR, slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), page);
  console.log(`Gerado: artigos/${slug}/index.html`);
}
