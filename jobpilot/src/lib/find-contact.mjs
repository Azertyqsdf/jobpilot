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
const CAREER = /(recrut|carri|career|emploi|jobs?|rejoindre|rejoignez|join|candidat|talent|travailler)/i;
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

function links(html, base, careersOnly = false) {
  const out = new Set();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname === new URL(base).hostname && (careersOnly ? CAREER : PAGE_HINT).test(u.pathname)) out.add(u.href.split('#')[0]);
    } catch {}
  }
  return [...out].slice(0, 8);
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

  // 2) Pages carrières / recrutement : liens du site + chemins usuels, puis un niveau de liens en plus
  //    depuis les pages carrières (offres, « candidature spontanée »).
  const origin = new URL(site.url).origin;
  const usual = ['recrutement', 'carrieres', 'carriere', 'careers', 'career', 'emploi', 'emplois', 'jobs', 'nous-rejoindre',
    'rejoignez-nous', 'rejoindre', 'join-us', 'offres-emploi', 'candidature-spontanee', 'travailler-chez-nous', 'contact', 'mentions-legales']
    .map(p => `${origin}/${p}`);
  const seen = new Set([site.url]);
  const pages = [site];
  const fetchAll = async (urls, max = 14) => {
    const fresh = [...new Set(urls)].filter(u => !seen.has(u)).slice(0, max);
    fresh.forEach(u => seen.add(u));
    if (Date.now() > deadline + 15000) return [];
    return (await Promise.all(fresh.map(u => get(u, 7000)))).filter(p => p && new URL(p.url).hostname === new URL(site.url).hostname);
  };
  // Pages essentielles d'abord (contact, mentions légales, recrutement), puis les liens trouvés sur la page d'accueil.
  const key = ['contact', 'mentions-legales', 'recrutement', 'carrieres', 'nous-rejoindre', 'jobs'].map(p => `${origin}/${p}`);
  const first = await fetchAll([...key, ...links(site.html, site.url).filter(u => /(contact|mention|legal)/i.test(u)), ...usual, ...links(site.html, site.url)]);
  pages.push(...first);
  const careers = first.filter(p => CAREER.test(p.url));
  pages.push(...await fetchAll(careers.flatMap(p => links(p.html, p.url, true))));
  if (proof < 2 && siren && pages.some(p => belongs(p.html, c.name, siren) === 2)) proof = 2;

  // 3) Seule une adresse de RECRUTEMENT est retenue : soit son nom l'indique (recrutement@, rh@, jobs@…),
  //    soit elle est publiée sur une page carrières / candidature du site, donc destinée aux candidats.
  //    Les adresses générales ou de service client (contact@, info@, hello@…) hors pages carrières sont écartées.
  const scored = [];
  // Adresses du pied de page (présentes sur la page d'accueil) : elles ne sont pas propres au recrutement.
  const everywhere = new Set(emailsIn(site.html));
  for (const p of pages) for (const e of emailsIn(p.html)) {
    const local = e.split('@')[0];
    const named = RANK[0][0].test(local);
    const onCareerPage = CAREER.test(p.url) && !everywhere.has(e);
    if (!named && !onCareerPage) continue;
    if (/^(sav|service-?client|client|customer|support|help|aide|commande|reservation|booking)/i.test(local)) continue;
    scored.push({ e, r: rankEmail(e, host) + (named ? 2 : 0) + (onCareerPage ? 1 : 0), from: p.url });
  }
  scored.sort((a, b) => b.r - a.r);
  const best = scored.find(s => s.r >= 3);

  // Indices pour juger si l'adresse générale est pertinente (décision prise ensuite, avec la taille de l'entreprise) :
  // l'entreprise est-elle un cabinet de recrutement / une agence d'emploi ? quelle est son adresse de contact ?
  const allText = normalize(pages.map(p => p.html.replace(/<[^>]+>/g, ' ')).join(' ').slice(0, 400000));
  const isRecruiter = /(cabinet de recrutement|cabinet de chasse|chasseur de tetes|executive search|recrutement par approche directe|agence d.interim|agence de recrutement|societe de portage|cabinet rh)/.test(allText);
  let generic = null;
  for (const p of pages) for (const e of emailsIn(p.html)) {
    const local = e.split('@')[0];
    if (!/^(contact|info|infos|bonjour|hello|accueil|agence|direction)/i.test(local)) continue;
    if (rankEmail(e, host) < 2) continue; // même domaine que le site uniquement
    const score = /contact/i.test(p.url) ? 2 : 1;
    if (!generic || score > generic.score) generic = { email: e, source: p.url, score };
  }
  // Numéros SIREN cités sur le site (mentions légales) : servent à confirmer l'identité dans l'annuaire officiel.
  const sirens = [...new Set([...pages.map(p => p.html).join(' ').matchAll(/(?:siren|siret|rcs)[^0-9]{0,40}((?:\d[\s.]?){9})/gi)].map(m => m[1].replace(/\D/g, '').slice(0, 9)))];
  const hints = { isRecruiter, sirens, generic: generic && { email: generic.email, source: generic.source } };

  if (!best) return { website: site.url, reason: "aucune adresse de recrutement publiée sur le site", v: 2, ...hints };
  return { website: site.url, email: best.e, source: best.from, verified: proof === 2 ? 'SIREN' : 'nom', kind: 'recrutement', v: 2, ...hints };
}
