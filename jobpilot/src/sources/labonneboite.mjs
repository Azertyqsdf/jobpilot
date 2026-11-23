// La Bonne Boîte v2 (France Travail) : entreprises susceptibles de recruter prochainement,
// même sans offre publiée → candidatures spontanées.
// Le contrat exact de l'API v2 est mal documenté publiquement : on essaie les variantes connues
// (chemin /recherche ou /company/, scopes avec ou sans « search office ») et on garde celle qui répond.

const TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const BASE = 'https://api.francetravail.io/partenaire/labonneboite/v2';

async function token(id, secret, scope) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`jeton refusé (${res.status}${res.status === 400 ? ' — accès La Bonne Boite non accordé à ton application ?' : ''})`);
  return (await res.json()).access_token;
}

const pick = (o, ...keys) => { for (const k of keys) { const v = k.split('.').reduce((x, p) => x?.[p], o); if (v !== undefined && v !== null && v !== '') return v; } return ''; };

function normalize(x, rome) {
  const siret = String(pick(x, 'siret', 'id'));
  const name = pick(x, 'enseigne', 'raisonSociale', 'raison_sociale', 'name', 'company_name');
  const city = pick(x, 'ville', 'city', 'commune', 'location.city', 'address.city');
  return {
    id: `lbb-${siret || name.toLowerCase().replace(/\W+/g, '-')}`,
    siret,
    name,
    legalName: pick(x, 'raisonSociale', 'raison_sociale'),
    city,
    postcode: pick(x, 'codePostal', 'code_postal', 'zipcode', 'postcode'),
    sector: pick(x, 'secteur', 'naf_label', 'nafLabel', 'libelleNaf', 'naf_text', 'sector'),
    headcount: pick(x, 'trancheEffectif', 'headcount_text', 'headcount', 'effectif'),
    score: Number(pick(x, 'score', 'stars', 'hiring_potential')) || 0,
    // L'API indique parfois seulement qu'un e-mail existe (« yes ») : on ne garde qu'une vraie adresse.
    email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(pick(x, 'email', 'contact.email'))) ? pick(x, 'email', 'contact.email') : '',
    phone: pick(x, 'telephone', 'phone'),
    website: pick(x, 'website', 'siteWeb', 'url'),
    distance: Number(pick(x, 'distance')) || null,
    rome,
  };
}

export async function laBonneBoite(prefs, env) {
  const cfg = prefs.laBonneBoite || {};
  if (!env.FT_CLIENT_ID || !env.FT_CLIENT_SECRET) return { skipped: 'FT_CLIENT_ID / FT_CLIENT_SECRET non configurés' };
  const zones = cfg.zones?.length ? cfg.zones : cfg.latitude != null ? [{ latitude: cfg.latitude, longitude: cfg.longitude, distance: cfg.distance }] : [];
  if (!cfg.romes?.length || !zones.length) return { skipped: 'codes métier ou position non configurés' };

  let access, lastErr;
  for (const scope of ['api_labonneboitev2 search office', 'api_labonneboitev2']) {
    try { access = await token(env.FT_CLIENT_ID, env.FT_CLIENT_SECRET, scope); break; } catch (e) { lastErr = e; }
  }
  if (!access) throw lastErr;

  const variants = [
    (rome, z) => `${BASE}/recherche?${new URLSearchParams({ rome, latitude: z.latitude, longitude: z.longitude, distance: z.distance || 30, page: 1, page_size: 100 })}`,
    (rome, z) => `${BASE}/company/?${new URLSearchParams({ rome_codes: rome, latitude: z.latitude, longitude: z.longitude, distance: z.distance || 30 })}`,
  ];
  const out = new Map();
  const errors = new Set();
  let working = null;
  for (const z of zones) for (const rome of cfg.romes) {
    const tries = working ? [working] : variants;
    const statuses = [];
    for (const v of tries) {
      await new Promise(r => setTimeout(r, 600)); // limite de l'API : 2 appels par seconde
      const url = v(rome, z);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) }).catch(e => ({ ok: false, status: e.message }));
      if (res.status === 204) { working = v; break; }
      if (!res.ok) { statuses.push(`${new URL(url).pathname.split('/').filter(Boolean).pop()} ${res.status}`); continue; }
      working = v;
      const j = await res.json();
      const list = Array.isArray(j) ? j : j.items || j.hits || j.companies || j.results || j.resultats || [];
      for (const x of list) {
        const c = normalize(x, rome);
        if (c.name && !out.has(c.id)) out.set(c.id, c);
      }
      statuses.length = 0;
      break;
    }
    if (statuses.length) errors.add(statuses.join(' / '));
  }
  if (!out.size && errors.size) throw new Error(`refus de l'API (${[...errors].slice(0, 2).join(' ; ')})`);
  return [...out.values()].sort((a, b) => b.score - a.score);
}
