// Sources d'offres d'emploi gratuites. Chaque source renvoie des offres au format commun :
// { id, source, title, company, location, remote, url, description, contactEmail, contract, salary, postedAt, tags }
import { htmlToText } from '../lib/text.mjs';

const UA = { 'User-Agent': 'jobpilot/1.0 (+personal job search)' };

async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url.split('?')[0]}`);
  return res.json();
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
function findEmail(text) {
  const m = text.match(EMAIL_RE);
  return m && !/noreply|no-reply|example\./i.test(m[0]) ? m[0] : null;
}

// --- Arbeitnow (Europe, sans clé) -------------------------------------------------------
export async function arbeitnow() {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const j = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
    for (const x of j.data || []) {
      const description = htmlToText(x.description);
      out.push({
        id: `arbeitnow-${x.slug}`.slice(0, 120),
        source: 'Arbeitnow',
        title: x.title,
        company: x.company_name,
        location: x.location || '',
        remote: !!x.remote,
        url: x.url,
        description,
        contactEmail: findEmail(description),
        contract: (x.job_types || []).join(', '),
        salary: '',
        postedAt: new Date((x.created_at || 0) * 1000).toISOString(),
        tags: x.tags || [],
      });
    }
    if (!j.links?.next) break;
  }
  return out;
}

// --- Remotive (100 % télétravail, sans clé) ---------------------------------------------
export async function remotive(prefs) {
  const out = [];
  const queries = [...new Set(prefs.queries.map(q => q.replace(/d[ée]veloppeu[rs]e?/i, 'developer')))];
  for (const q of queries.slice(0, 6)) {
    const j = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`);
    for (const x of j.jobs || []) {
      const description = htmlToText(x.description);
      out.push({
        id: `remotive-${x.id}`,
        source: 'Remotive',
        title: x.title,
        company: x.company_name,
        location: x.candidate_required_location || 'Remote',
        remote: true,
        url: x.url,
        description,
        contactEmail: findEmail(description),
        contract: x.job_type || '',
        salary: x.salary || '',
        postedAt: new Date(x.publication_date + 'Z').toISOString(),
        tags: x.tags || [],
      });
    }
  }
  return out;
}

// --- France Travail (ex-Pôle emploi) — gratuit, clés via francetravail.io ---------------
export async function franceTravail(prefs, env) {
  const { FT_CLIENT_ID: id, FT_CLIENT_SECRET: secret } = env;
  if (!id || !secret) return { skipped: 'FT_CLIENT_ID / FT_CLIENT_SECRET non configurés' };
  const tokenRes = await fetch('https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'api_offresdemploiv2 o2dsoffre' }),
    signal: AbortSignal.timeout(30000),
  });
  if (tokenRes.status === 400 || tokenRes.status === 401) return { skipped: "accès à l'API « Offres d'emploi » non accordé (autorisation spéciale à demander)" };
  if (!tokenRes.ok) throw new Error(`OAuth France Travail : ${tokenRes.status}`);
  const { access_token } = await tokenRes.json();
  const out = [];
  const deps = prefs.franceTravail?.departements?.length ? prefs.franceTravail.departements : [null];
  for (const q of prefs.queries.slice(0, 5)) {
    for (const dep of deps) {
      const params = new URLSearchParams({ motsCles: q, range: '0-99', sort: '1' });
      if (dep) params.set('departement', dep);
      const res = await fetch(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`, {
        headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 204) continue;
      if (!res.ok && res.status !== 206) throw new Error(`France Travail : ${res.status}`);
      const j = await res.json();
      for (const x of j.resultats || []) {
        const description = x.description || '';
        out.push({
          id: `ft-${x.id}`,
          source: 'France Travail',
          title: x.intitule,
          company: x.entreprise?.nom || 'Entreprise (non communiquée)',
          location: x.lieuTravail?.libelle || '',
          remote: /t[ée]l[ée]travail/i.test(description),
          url: x.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${x.id}`,
          description,
          contactEmail: x.contact?.courriel || findEmail(description),
          contract: [x.typeContratLibelle, x.dureeTravailLibelle].filter(Boolean).join(' — '),
          salary: x.salaire?.libelle || '',
          postedAt: x.dateCreation,
          tags: [x.romeLibelle, x.appellationlibelle].filter(Boolean),
        });
      }
    }
  }
  return out;
}

// --- Adzuna (agrégateur, gratuit avec clé développeur) ----------------------------------
export async function adzuna(prefs, env) {
  const { ADZUNA_APP_ID: id, ADZUNA_APP_KEY: key } = env;
  if (!id || !key) return { skipped: 'ADZUNA_APP_ID / ADZUNA_APP_KEY non configurés' };
  const country = prefs.adzuna?.country || 'fr';
  const out = [];
  for (const q of prefs.queries.slice(0, 5)) {
    const params = new URLSearchParams({ app_id: id, app_key: key, what: q, results_per_page: '50', max_days_old: String(prefs.maxAgeDays || 30) });
    if (prefs.adzuna?.where) params.set('where', prefs.adzuna.where);
    const j = await getJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`);
    for (const x of j.results || []) {
      const description = htmlToText(x.description);
      out.push({
        id: `adzuna-${x.id}`,
        source: 'Adzuna',
        title: htmlToText(x.title),
        company: x.company?.display_name || '',
        location: x.location?.display_name || '',
        remote: /remote|t[ée]l[ée]travail/i.test(description + x.title),
        url: x.redirect_url,
        description,
        contactEmail: null,
        contract: [x.contract_type, x.contract_time].filter(Boolean).join(', '),
        salary: x.salary_min ? `${Math.round(x.salary_min)}–${Math.round(x.salary_max || x.salary_min)} €` : '',
        postedAt: x.created,
        tags: [x.category?.label].filter(Boolean),
      });
    }
  }
  return out;
}

export const SOURCES = { arbeitnow, remotive, franceTravail, adzuna };
