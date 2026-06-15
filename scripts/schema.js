'use strict';

const BASE_URL = 'https://promopobre.com.br';
const ORG = { '@type': 'Organization', name: 'PromoPobre', url: BASE_URL };

// Remove recursively: null, undefined, '', [], {}
function clean(obj) {
  if (Array.isArray(obj)) {
    const arr = obj.map(clean).filter(v => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (obj !== null && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = clean(v);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return (obj === null || obj === undefined || obj === '') ? undefined : obj;
}

function extractFAQ(markdown) {
  const faqMatch = markdown.match(
    /##+ (?:FAQ|Perguntas\s+[Ff]requentes|Dúvidas[^\n]*)\n([\s\S]*?)(?=\n##+ |\s*$)/i
  );
  if (!faqMatch) return [];

  const section = faqMatch[1];
  const items = [];

  // Padrão 1: ### Pergunta?\nResposta
  const h3Re = /###+ ([^\n]+)\n([\s\S]*?)(?=###+ |\s*$)/g;
  let m;
  while ((m = h3Re.exec(section)) !== null) {
    const q = m[1].trim();
    const a = m[2].trim().replace(/\*\*/g, '').replace(/\n+/g, ' ');
    if (q && a) items.push({ question: q, answer: a });
  }
  if (items.length) return items;

  // Padrão 2: **Pergunta?**\nResposta
  const boldRe = /\*\*([^*]+\?)\*\*\n+([\s\S]*?)(?=\*\*[^*]+\?\*\*|\s*$)/g;
  while ((m = boldRe.exec(section)) !== null) {
    const q = m[1].trim();
    const a = m[2].trim().replace(/\n+/g, ' ');
    if (q && a) items.push({ question: q, answer: a });
  }

  return items;
}

function extractListItems(markdown) {
  const items = [];
  const re = /^[-*\d.]+\s+\[([^\]]+)\]\(([^)]+)\)/gm;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    items.push({ name: m[1], url: m[2] });
  }
  return items;
}

/**
 * Gera array de schemas Schema.org para um artigo.
 * @param {object} data     - Frontmatter do artigo (gray-matter)
 * @param {string} content  - Corpo do artigo em Markdown
 * @param {string} slug     - Slug da URL
 * @param {string} today    - Data de hoje (YYYY-MM-DD)
 * @returns {object[]}      - Array de schemas prontos para JSON.stringify
 */
function generateArticleSchema(data, content, slug, today) {
  const url         = `${BASE_URL}/artigos/${slug}/`;
  const pubDate     = data.publish_date || data.date || today;
  const schemas     = [];

  // 1. Article — sempre presente
  schemas.push(clean({
    '@context':        'https://schema.org',
    '@type':           'Article',
    headline:          data.title,
    description:       data.description,
    datePublished:     pubDate,
    dateModified:      today,
    image:             data.image,
    url,
    mainEntityOfPage:  { '@type': 'WebPage', '@id': url },
    author:            ORG,
    publisher:         ORG,
  }));

  // 2. Product + Review — type: review
  if (data.type === 'review') {
    const productName = data.product_name || data.title;

    schemas.push(clean({
      '@context': 'https://schema.org',
      '@type':    'Product',
      name:       productName,
      image:      data.image,
      brand:      data.product_brand
        ? { '@type': 'Brand', name: data.product_brand }
        : undefined,
      offers: data.product_url ? clean({
        '@type':       'Offer',
        url:           data.product_url,
        price:         data.product_price != null ? String(data.product_price) : undefined,
        priceCurrency: data.product_price != null ? 'BRL' : undefined,
        availability:  'https://schema.org/InStock',
      }) : undefined,
    }));

    schemas.push(clean({
      '@context':   'https://schema.org',
      '@type':      'Review',
      itemReviewed: { '@type': 'Product', name: productName },
      author:       ORG,
      reviewBody:   data.description,
      reviewRating: data.rating != null ? clean({
        '@type':      'Rating',
        ratingValue:  data.rating,
        bestRating:   5,
        worstRating:  1,
      }) : undefined,
    }));
  }

  // 3. ItemList — type: guide | list
  if (data.type === 'guide' || data.type === 'list') {
    const items = extractListItems(content);
    if (items.length) {
      schemas.push(clean({
        '@context':      'https://schema.org',
        '@type':         'ItemList',
        name:            data.title,
        itemListElement: items.map((item, i) => ({
          '@type':   'ListItem',
          position:  i + 1,
          name:      item.name,
          url:       item.url,
        })),
      }));
    }
  }

  // 4. FAQPage — detectado automaticamente pelo conteúdo
  const faqItems = extractFAQ(content);
  if (faqItems.length) {
    schemas.push(clean({
      '@context':  'https://schema.org',
      '@type':     'FAQPage',
      mainEntity:  faqItems.map(({ question, answer }) => ({
        '@type': 'Question',
        name:    question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })),
    }));
  }

  return schemas.filter(Boolean);
}

/**
 * Serializa os schemas como tags <script type="application/ld+json"> prontas para HTML.
 */
function renderSchemas(schemas) {
  return schemas
    .map(s => `<script type="application/ld+json">\n${JSON.stringify(s, null, 2)}\n</script>`)
    .join('\n');
}

module.exports = { generateArticleSchema, renderSchemas };
