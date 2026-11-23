// Outils texte : normalisation, décodage HTML, tokenisation, correspondance de termes.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s = '') {
  let prev;
  // Certaines API double-encodent (&amp;lt;div&amp;gt;) : on décode jusqu'à stabilité.
  for (let i = 0; i < 3 && prev !== s; i++) {
    prev = s;
    s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  }
  return s;
}

export function htmlToText(html = '') {
  return decodeEntities(String(html))
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|br|tr)>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export function normalize(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(`a an and are as at be by for from has have in is it its of on or that the to with we you your our will
au aux avec ce ces dans de des du elle en et eux il je la le les leur lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous c d j l m n s t y ete etre avoir sont est plus tres
der die das und mit fur von zu im ein eine`.split(/\s+/));

export function tokens(s) {
  return normalize(s)
    .split(/[\s/]+/)
    .map(t => t.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter(t => t.length > 1 && !STOP.has(t));
}

/** Vrai si le terme (mot ou expression) apparaît comme mot entier dans le texte normalisé. */
export function hasTerm(normText, term) {
  const t = normalize(term);
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(normText);
}

/** Vrai si le texte contient le préfixe (ex. « développeu » couvre développeur/développeuse). */
export function hasPrefix(normText, prefix) {
  const p = normalize(prefix);
  if (!p) return false;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}`).test(normText);
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function slugify(s = '') {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
