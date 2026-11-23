// Recherche de l'adresse e-mail de candidature d'une entreprise.
// Règles : on ne devine JAMAIS une adresse. On cherche le site officiel de l'entreprise, on vérifie
// qu'il s'agit bien d'elle (SIREN ou nom dans les pages), puis on ne retient qu'une adresse publiée
// sur ce site, en préférant recrutement / RH, sinon contact général.
import { normalize } from './text.mjs';

const UA = 'Mozilla/5.0 (compatible; JobPilot/1.0; recherche d\'emploi personnelle)';
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const LEGAL = /\b(sa|sas|sasu|sarl|eurl|sci|snc|scop|group|groupe|france|holding|international|ste|societe|et|de|du|des|la|le|les|l)\b/g;
const BAD_LOCAL = /^(no-?reply|ne-?pas-?repondre|donotreply|dpo|rgpd|gdpr|privacy|cnil|webmaster|admin|abuse|postmaster|compta|comptabilite|factur|invoice|billing|sav|support|presse|press|media|marketing|newsletter|commande|order|example|test|wordpress|wix|sentry|user|name|email|votre|your)/i;
const BAD_DOMAIN = /(example\.|sentry|wixpress|godaddy|domain\.|email\.com$|yourdomain|sentry\.io|cloudflare|googleapis|w3\.org|schema\.org|png$|jpg$|gif$|svg$|webp$)/i;
const RANK = [
  [/(recrut|recruit|rh\b|^rh|drh|hr\b|^hr|jobs?|emploi|career|carriere|candidat|talent|rejoindre|join)/i, 3],
  [/^(contact|info|infos|accueil|bonjour|hello|direction|commercial|administration|secretariat)/i, 2],
];
const PAGE_HINT = /(recrut|carri|career|emploi|jobs?|rejoindre|join-us|nous-rejoindre|contact|mentions|legal|a-propos|about|qui-sommes)/i;

async function get(url, ms = 8000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return null;
    const html = (await res.text()).slice(0, 1_500_000);
    return { url: res.url, html };
  } catch { return null; }
}

function slugs(name) {
  const base = normalize(name).replace(/[^a-z0-9 ]/g, ' ').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return [];
  const words = base.split(' ');
  return [...new Set([words.join(''), words.join('-'), words.slice(0, 2).join(''), words.slice(0, 2).join('-'), words[0]])].filter(s => s.length >= 3);
}

/** Le site appartient-il bien à l'entreprise ? SIREN (le plus sûr) ou nom présent dans la page. */
const FORMS = /\b(sa|sas|sasu|sarl|eurl|sci|snc|scop)\b/g;
function belongs(html, name, siren) {
  const text = normalize(html.replace(/<[^>]+>/g, ' '));
  if (siren && text.replace(/\s/g, '').includes(siren)) return 2;
  // Nom complet (seule la forme juridique est retirée) : « societe generale » ≠ « generale ».
  const variants = [normalize(name).replace(FORMS, ' '), normalize(name).replace(/[^a-z0-9 ]/g, ' ').replace(FORMS, ' ')]
    .map(v => v.replace(/\s+/g, ' ').trim()).filter(v => v.length >= 4);
  return variants.some(v => new RegExp(`(^|[^a-z0-9])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text)) ? 1 : 0;
}

function emailsIn(html) {
  const deob = html.replace(/\s*(\[|\()\s*(at|arobase)\s*(\]|\))\s*/gi, '@').replace(/\s*(\[|\()\s*(dot|point)\s*(\]|\))\s*/gi, '.');
  const found = new Set();
  for (const m of deob.matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of deob.replace(/<[^>]+>/g, ' ').matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  return [...found].filter(e => {
    const [local, domain] = e.split('@');
    return local && domain && !BAD_LOCAL.test(local) && !BAD_DOMAIN.test(domain) && !/\d{6,}/.test(local);
  });
}

function links(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname === new URL(base).hostname && PAGE_HINT.test(u.pathname)) out.add(u.href.split('#')[0]);
    } catch {}
  }
  return [...out].slice(0, 6);
}

function rankEmail(email, siteHost) {
  const [local, domain] = email.split('@');
  let r = 0;
  for (const [re, v] of RANK) if (re.test(local)) { r = Math.max(r, v); }
  const sameDomain = siteHost.replace(/^www\./, '').endsWith(domain) || domain.endsWith(siteHost.replace(/^www\./, ''));
  if (sameDomain) r += 1;
  else if (!/(gmail|orange|wanadoo|free|sfr|outlook|hotmail|laposte|bluewin)\./.test(domain)) r -= 2; // adresse d'un autre site : écartée
  // Adresse nominative (prenom.nom@) : seulement si elle est clairement liée au recrutement.
  if (/^[a-z]+[._-][a-z]+$/.test(local) && r < 3) r -= 1;
  return r;
}

/**
 * @param {{ name: string, siret?: string, city?: string, website?: string }} c
 * @returns {Promise<{ website?: string, email?: string, source?: string, verified?: string, reason?: string }>}
 */
export async function findContact(c, budgetMs = 25000) {
  const deadline = Date.now() + budgetMs;
  const siren = c.siret ? String(c.siret).replace(/\D/g, '').slice(0, 9) : null;
  // 1) Site officiel : celui fourni par la source, sinon on teste les noms de domaine évidents.
  const candidates = [];
  if (c.website) candidates.push(c.website.startsWith('http') ? c.website : `https://${c.website}`);
  for (const s of slugs(c.name)) for (const tld of ['fr', 'com', 'ch', 'eu']) candidates.push(`https://www.${s}.${tld}/`, `https://${s}.${tld}/`);
  let site = null, proof = 0;
  for (const url of [...new Set(candidates)].slice(0, 40)) {
    if (Date.now() > deadline) break;
    const page = await get(url, 6000);
    if (!page) continue;
    const b = belongs(page.html, c.name, siren);
    if (b) { site = page; proof = b; break; }
  }
  if (!site) return { reason: 'site officiel introuvable' };
  const host = new URL(site.url).hostname;

  // 2) Pages utiles du site (recrutement, contact, mentions légales) et adresses publiées.
  const pages = [site, ...(await Promise.all(links(site.html, site.url).map(u => get(u))))].filter(Boolean);
  if (proof < 2 && siren && pages.some(p => belongs(p.html, c.name, siren) === 2)) proof = 2;
  const scored = [];
  for (const p of pages) for (const e of emailsIn(p.html)) {
    const r = rankEmail(e, host) + (/(recrut|carri|career|emploi|jobs?|rejoindre)/i.test(p.url) ? 1 : 0);
    scored.push({ e, r, from: p.url });
  }
  scored.sort((a, b) => b.r - a.r);
  const best = scored.find(s => s.r >= 2);
  if (!best) return { website: site.url, reason: 'aucune adresse de recrutement ou de contact publiée' };
  return { website: site.url, email: best.e, source: best.from, verified: proof === 2 ? 'SIREN' : 'nom' };
}
