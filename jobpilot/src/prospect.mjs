// Prospection : pour les entreprises qui recrutent dans ton domaine (La Bonne Boîte + entreprises
// qui publient des offres correspondant à ton profil), trouve l'adresse de candidature publiée sur
// leur site officiel. Les résultats sont mis en cache (data/contacts.json) : chaque passage traite
// de nouvelles entreprises, et une entreprise sans adresse est revérifiée au bout de 30 jours.
import { readFile, writeFile } from 'node:fs/promises';
import { findContact } from './lib/find-contact.mjs';
import { normalize, isEmail } from './lib/text.mjs';

const root = new URL('..', import.meta.url);
const read = async (p, d) => JSON.parse(await readFile(new URL(p, root), 'utf8').catch(() => JSON.stringify(d)));
const save = (p, v, pretty = 1) => writeFile(new URL(p, root), JSON.stringify(v, null, pretty));

const PER_RUN = +(process.env.PROSPECT_PER_RUN || 25);
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
  if (k && !SKIP.test(k) && !targets.has(k)) targets.set(k, { name: c.name, siret: c.siret, city: c.city, website: c.website });
}

const due = [...targets.entries()].filter(([k]) => {
  const c = cache[k];
  if (!c) return true;
  if (c.email) return false;
  return (Date.now() - new Date(c.checkedAt)) / 864e5 > RECHECK_DAYS;
}).slice(0, PER_RUN);

let found = 0;
// 4 entreprises en parallèle, chacune avec un budget de temps limité.
for (let i = 0; i < due.length; i += 4) {
  await Promise.all(due.slice(i, i + 4).map(async ([k, t]) => {
    const r = await findContact(t).catch(e => ({ reason: e.message }));
    cache[k] = { name: t.name, ...r, checkedAt: new Date().toISOString() };
    if (r.email) found++;
    console.log(`${t.name.padEnd(34).slice(0, 34)} ${r.email ? `✉️  ${r.email} (vérifié par ${r.verified})` : `— ${r.reason}`}`);
  }));
}

// Rattache les adresses trouvées aux offres et aux entreprises (sans écraser une adresse donnée par l'offre).
let jobsWith = 0, compWith = 0;
for (const j of jobsDb.jobs) {
  const c = cache[key(j.company)];
  if (!isEmail(j.contactEmail) && c?.email) { j.contactEmail = c.email; j.contactEmailSource = c.source; }
  if (isEmail(j.contactEmail)) jobsWith++;
}
for (const co of compDb.companies) {
  const c = cache[key(co.name)];
  if (!isEmail(co.email) && c?.email) { co.email = c.email; co.emailSource = c.source; co.website ||= c.website; }
  if (isEmail(co.email)) compWith++;
}

await save('data/contacts.json', cache, 2);
await save('data/jobs.json', jobsDb);
await save('data/companies.json', compDb);
const run = await read('data/run.json', {});
run.prospection = `${due.length} entreprises examinées, ${found} nouvelles adresses ; ${jobsWith} offres et ${compWith} entreprises joignables par e-mail`;
await save('data/run.json', run, 2);
console.log(`\n${run.prospection}`);
