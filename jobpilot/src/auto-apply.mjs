// Candidatures automatiques : après chaque recherche, prépare (et envoie quand l'offre donne un e-mail
// et que l'envoi automatique est activé) les candidatures pour les meilleures offres, dans la limite
// d'un nombre par jour. Les offres ignorées ou déjà traitées dans le suivi sont laissées de côté.
// Désactivé par défaut : seul l'utilisateur l'active ou le désactive (onglet « Recherche » de l'interface).
// Réglages : profile/preferences.json → autoApply.
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applicationFolder, isEmail } from './lib/text.mjs';

const root = new URL('..', import.meta.url);
const read = async (p, d) => JSON.parse(await readFile(new URL(p, root), 'utf8').catch(() => JSON.stringify(d)));

const prefs = await read('profile/preferences.json', {});
const cfg = { enabled: false, minScore: 80, maxPerDay: 5, onlyWithEmail: false, spontaneous: false, ...(prefs.autoApply || {}) };
if (!cfg.enabled) { console.log('Candidatures automatiques désactivées.'); process.exit(0); }

const { jobs = [] } = await read('data/jobs.json', {});
const { companies = [] } = await read('data/companies.json', {});
const { apps = {} } = await read('data/tracking.json', {});
const folders = new Set(await readdir(new URL('data/applications/', root)).catch(() => []));

// Combien de candidatures automatiques déjà faites aujourd'hui ?
const today = new Date().toISOString().slice(0, 10);
let doneToday = 0;
for (const f of folders) {
  const m = await read(`data/applications/${f}/meta.json`, {});
  if (m.auto && String(m.createdAt).startsWith(today)) doneToday++;
}
const budget = Math.max(0, cfg.maxPerDay - doneToday);
if (!budget) { console.log(`Limite atteinte (${cfg.maxPerDay} par jour).`); process.exit(0); }

// Adresses déjà utilisées (90 derniers jours) : on n'écrit jamais deux fois à la même entreprise.
const usedEmails = new Set();
for (const f of folders) {
  const m = await read(`data/applications/${f}/meta.json`, {});
  if (m.contactEmail && (Date.now() - new Date(m.createdAt)) / 864e5 < 90) usedEmails.add(String(m.contactEmail).toLowerCase());
}
const free = j => !apps[j.id] && !folders.has(applicationFolder(j.id)) && !usedEmails.has(String(j.contactEmail || j.email || '').toLowerCase());
const candidates = jobs
  .filter(j => free(j) && j.status === 'new' && !j.manual && j.score >= cfg.minScore && (!cfg.onlyWithEmail || isEmail(j.contactEmail)))
  .sort((a, b) => isEmail(b.contactEmail) - isEmail(a.contactEmail) || b.score - a.score)
  .map(j => j.id);
if (cfg.spontaneous) {
  candidates.push(...companies.filter(c => free(c) && isEmail(c.email)).map(c => c.id)); // spontanée : seulement si un e-mail est connu
}
const byId = new Map([...jobs, ...companies].map(x => [x.id, x]));
const seenMail = new Set();
const ids = candidates.filter(id => {
  const m = String(byId.get(id)?.contactEmail || byId.get(id)?.email || '').toLowerCase();
  if (!m) return true;
  if (seenMail.has(m)) return false;
  seenMail.add(m); return true;
}).slice(0, budget);
if (!ids.length) { console.log('Aucune nouvelle offre ne remplit les critères.'); process.exit(0); }

console.log(`Candidatures automatiques : ${ids.length} (limite du jour ${cfg.maxPerDay}, déjà ${doneToday}).`);
execFileSync(process.execPath, [fileURLToPath(new URL('apply.mjs', import.meta.url)), ...ids], { stdio: 'inherit', env: { ...process.env, AUTO_MODE: '1' } });
