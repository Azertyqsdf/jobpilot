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
    email: pick(x, 'email', 'contact.email'),
    phone: pick(x, 'telephone', 'phone'),
    website: pick(x, 'website', 'siteWeb', 'url'),
    distance: Number(pick(x, 'distance')) || null,
    rome,
  };
}

export async function laBonneBoite(prefs, env) {
  const cfg = prefs.laBonneBoite || {};
  if (!env.FT_CLIENT_ID || !env.FT_CLIENT_SECRET) return { skipped: 'FT_CLIENT_ID / FT_CLIENT_SECRET non configurés' };
  if (!cfg.romes?.length || cfg.latitude == null) return { skipped: 'codes métier ou position non configurés' };

  let access, lastErr;
  for (const scope of ['api_labonneboitev2 search office', 'api_labonneboitev2']) {
    try { access = await token(env.FT_CLIENT_ID, env.FT_CLIENT_SECRET, scope); break; } catch (e) { lastErr = e; }
  }
  if (!access) throw lastErr;

  const variants = [
    rome => `${BASE}/recherche?${new URLSearchParams({ rome, latitude: cfg.latitude, longitude: cfg.longitude, distance: cfg.distance || 30, page: 1, page_size: 100 })}`,
    rome => `${BASE}/company/?${new URLSearchParams({ rome_codes: rome, latitude: cfg.latitude, longitude: cfg.longitude, distance: cfg.distance || 30 })}`,
  ];
  const out = new Map();
  let working = null;
  for (const rome of cfg.romes) {
    const tries = working ? [working] : variants;
    for (const v of tries) {
      const res = await fetch(v(rome), { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 204) { working = v; break; }
      if (!res.ok) { lastErr = new Error(`${res.status} sur ${new URL(v(rome)).pathname}`); continue; }
      working = v;
      const j = await res.json();
      const list = Array.isArray(j) ? j : j.items || j.hits || j.companies || j.results || j.resultats || [];
      for (const x of list) {
        const c = normalize(x, rome);
        if (c.name && !out.has(c.id)) out.set(c.id, c);
      }
      break;
    }
    if (!working) throw lastErr;
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}
