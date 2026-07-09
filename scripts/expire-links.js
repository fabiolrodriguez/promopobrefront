const fs   = require('fs');
const path = require('path');

const LINKS_FILE = path.join(__dirname, '..', 'links.json');
const links = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
const now   = Date.now();

const active  = links.filter(item => !item.expires_at || item.expires_at > now);
const removed = links.length - active.length;

if (removed > 0) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(active, null, 2) + '\n');
  console.log(`Expirados e removidos: ${removed} produto(s) com cupom vencido.`);
} else {
  console.log('Nenhum produto expirado.');
}
