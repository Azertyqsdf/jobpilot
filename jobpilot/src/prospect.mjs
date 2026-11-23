// Prospection : pour les entreprises qui recrutent dans ton domaine (La Bonne Boîte + entreprises
// qui publient des offres correspondant à ton profil), trouve l'adresse de candidature publiée sur
// leur site officiel. Les résultats sont mis en cache (data/contacts.json) : chaque passage traite
// de nouvelles entreprises, et une entreprise sans adresse est revérifiée au bout de 30 jours.
import { readFile, writeFile } from 'node:fs/promises';
import { findContact } from './lib/find-contact.mjs';
import { companyInfo, genericContactVerdict } from './lib/company-size.mjs';
import { normalize, isEmail } from './lib/text.mjs';

const root = new URL('..', import.meta.url);
const read = async (p, d) => JSON.parse(await readFile(new URL(p, root), 'utf8').catch(() => JSON.stringify(d)));
const save = (p, v, pretty = 1) => writeFile(new URL(p, root), JSON.stringify(v, null, pretty));

const PER_RUN = +(process.env.PROSPECT_PER_RUN || 40);
const RECHECK_DAYS = 30;
// Éditeurs d'annonces ou noms génériques : ce ne sont pas les employeurs.
const SKIP = /^(france travail|pole emploi|direct emploi|entreprise \(non communiquee\)|confidentiel|confidential|anonyme|.*interim.*|.*recrutement.*)$/;

const jobsDb = await read('data/jobs.json', { jobs: [] });
const compDb = await read('data/companies.json', { companies: [] });
const cache = await read('data/contacts.json', {});
const key = name => normalize(name).replace(/[^a-z0-9]+/g, ' ').trim();

// Entreprises à examiner : d'abord celles des meilleures offres, puis La Bonne Boîte (potentiel d'embauche).
const targets = new Map();
for (const j of [...jobsDb.jobs].sort((a, b) => b.score - a.score)) {
  const k = key(j.company);
  if (k && !SKIP.test(k) && !targets.has(k)) targets.set(k, { name: j.company, city: j.location });
}
for (const c of compDb.companies) {
  const k = key(c.name);
  if (k && !SKIP.test(k) && !targets.has(k)) targets.set(k, { name: c.name, siret: c.siret, city: c.city, postcode: c.postcode, website: c.website, headcount: c.headcount });
}

// Priorité à la Haute-Savoie (lieu de vie), puis Genève, puis le reste.
const HOME = /(haute-savoie|\b74\d{0,3}\b|annecy|annemasse|thonon|evian|cluses|sallanches|bonneville|roche-sur-foron|saint-julien|marignier|marnaz|scionzier|rumilly|passy|chamonix|saint-jeoire|reignier|douvaine|gaillard)/i;
const GENEVA = /(gen[eè]ve|geneva|genf|carouge|lancy|vernier|meyrin)/i;
const prio = t => (HOME.test(`${t.city || ''} ${t.postcode || ''}`) ? 0 : GENEVA.test(t.city || '') ? 1 : 2);
const ordered = [...targets.entries()].sort((a, b) => prio(a[1]) - prio(b[1]));
const due = ordered.filter(([k]) => {
  const c = cache[k];
  if (!c) return true;
  if (c.v !== 3) return true; // résultat obtenu avec une ancienne règle : on revérifie
  if (c.email) return false;
  return (Date.now() - new Date(c.checkedAt)) / 864e5 > RECHECK_DAYS;
}).slice(0, PER_RUN);

let found = 0;
// 4 entreprises en parallèle, chacune avec un budget de temps limité.
for (let i = 0; i < due.length; i += 4) {
  await Promise.all(due.slice(i, i + 4).map(async ([k, t]) => {
    const r = await findContact(t).catch(e => ({ reason: e.message }));
    // Pas d'adresse de recrutement mais une adresse générale : on juge si elle est pertinente
    // (taille et activité d'après l'annuaire public, cabinet de recrutement ou non).
    if (!r.email && r.generic?.email) {
      let info = await companyInfo({ name: t.name, siret: t.siret, postcode: t.postcode });
      // Identité confirmée seulement si le SIREN de l'annuaire est celui de la source ou figure sur le site (homonymes).
      const confirmed = info && ((t.siret && String(t.siret).startsWith(info.siren)) || (r.sirens || []).includes(info.siren));
      if (!confirmed) info = null;
      const verdict = genericContactVerdict({ info, isRecruiter: r.isRecruiter, lbbHeadcount: t.headcount });
      r.genericVerdict = verdict.why;
      if (verdict.ok) Object.assign(r, { email: r.generic.email, source: r.generic.source, kind: 'contact-pertinent', why: verdict.why, verified: r.verified || 'nom' });
    }
    cache[k] = { name: t.name, ...r, v: 3, checkedAt: new Date().toISOString() };
    if (r.email) found++;
    console.log(`${t.name.padEnd(34).slice(0, 34)} ${r.email ? `✉️  ${r.email} (${r.kind === 'contact-pertinent' ? r.why : 'recrutement'})` : `— ${r.genericVerdict || r.reason}`}`);
  }));
}

// Seule une adresse de recrutement est utilisée (jamais contact@ / service client).
const usable = c => c?.email && c.v === 3 && (c.kind === 'recrutement' || c.kind === 'contact-pertinent');

// Rattache les adresses trouvées aux offres et aux entreprises (sans écraser une adresse donnée par l'offre).
let jobsWith = 0, compWith = 0;
for (const j of jobsDb.jobs) {
  const c = cache[key(j.company)];
  if (!isEmail(j.contactEmail) && usable(c)) { j.contactEmail = c.email; j.contactEmailSource = c.source; j.contactEmailWhy = c.why || 'adresse de recrutement'; }
  if (isEmail(j.contactEmail)) jobsWith++;
}
for (const co of compDb.companies) {
  const c = cache[key(co.name)];
  if (!isEmail(co.email) && usable(c)) { co.email = c.email; co.emailSource = c.source; co.emailWhy = c.why || 'adresse de recrutement'; co.website ||= c.website; }
  if (isEmail(co.email)) compWith++;
}

await save('data/contacts.json', cache, 2);
await save('data/jobs.json', jobsDb);
await save('data/companies.json', compDb);
const run = await read('data/run.json', {});
run.prospection = `${due.length} entreprises examinées, ${found} nouvelles adresses ; ${jobsWith} offres et ${compWith} entreprises joignables par e-mail`;
await save('data/run.json', run, 2);
console.log(`\n${run.prospection}`);
