// Étape 1 : récupère les offres sur toutes les sources, les note et garde les plus pertinentes.
// Usage : node src/fetch-jobs.mjs
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { applicationFolder } from './lib/text.mjs';
import { SOURCES } from './sources/index.mjs';
import { scoreJob } from './lib/match.mjs';
import { normalize, hasPrefix } from './lib/text.mjs';
import { laBonneBoite } from './sources/labonneboite.mjs';
import { annualSalary } from './lib/salary.mjs';
import { whoRecruits, offerReference } from './lib/recruiter.mjs';
import { extractiveSummary, aiSummaries } from './lib/summary.mjs';

const root = new URL('..', import.meta.url);
const read = async p => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const readOr = async (p, d) => read(p).catch(() => d);

const profile = await read('profile/profile.json');
const prefs = await read('profile/preferences.json');
const previous = await readOr('data/jobs.json', { jobs: [] });
const prevById = new Map(previous.jobs.map(j => [j.id, j]));

const run = { startedAt: new Date().toISOString(), sources: {} };
let raw = [];
for (const [name, fn] of Object.entries(SOURCES)) {
  if (prefs.sources?.[name] === false) { run.sources[name] = 'désactivée'; continue; }
  try {
    const r = await fn(prefs, process.env);
    if (Array.isArray(r)) { raw = raw.concat(r); run.sources[name] = `${r.length} offres`; }
    else run.sources[name] = r.skipped;
  } catch (e) {
    run.sources[name] = `erreur : ${e.message}`;
  }
  console.log(`${name.padEnd(14)} ${run.sources[name]}`);
}

// Offres ajoutées à la main (ex. offre de test) : toujours prises en compte.
const manual = (await readOr('data/manual-jobs.json', { jobs: [] })).jobs || [];
if (manual.length) { raw = raw.concat(manual.map(j => ({ tags: [], remote: false, ...j, source: j.source || 'Ajout manuel', manual: true }))); run.sources.manuel = `${manual.length} offre(s)`; }

// Dédoublonnage (même entreprise + même titre).
const seen = new Set();
const unique = raw.filter(j => {
  const k = `${j.company}|${j.title}`.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const kept = [];
// Décompte par zone : offres trouvées, retenues, et raisons d'exclusion (affiché dans l'onglet Robot).
const zoneOf = j => /(haute-savoie|annecy|annemasse|thonon|evian|cluses|sallanches|bonneville|roche-sur-foron|saint-julien|marignier|marnaz|scionzier|rumilly|passy|chamonix|\(74\)|^74)/i.test(j.location) ? 'Haute-Savoie'
  : /(gen[eè]ve|geneva|genf|carouge|lancy|vernier|meyrin)/i.test(j.location) ? 'Genève' : /lyon|villeurbanne|rh[oô]ne/i.test(j.location) ? 'Lyon' : 'autres';
const zones = {};
const tally = (z, k) => { zones[z] ||= { trouvees: 0, retenues: 0, exclues: {} }; if (k === 'trouvees' || k === 'retenues') zones[z][k]++; else zones[z].exclues[k] = (zones[z].exclues[k] || 0) + 1; };
for (const job of unique) {
  const s = scoreJob(job, profile, prefs);
  const z = zoneOf(job); tally(z, 'trouvees');
  if (s.excluded) tally(z, s.excluded.replace(/ \(.*$/, ''));
  else if (s.score < prefs.minScore) tally(z, `note < ${prefs.minScore}`);
  else tally(z, 'retenues');
  if (!job.manual && (s.excluded || s.score < prefs.minScore)) continue;
  const prev = prevById.get(job.id);
  kept.push({ ...job, description: job.description.slice(0, 12000), score: s.score, reasons: s.reasons, matchedSkills: s.skills, status: prev?.status || 'new', firstSeen: prev?.firstSeen || run.startedAt });
}

// On conserve les offres déjà traitées (postulées / candidatures prêtes) même si elles ont disparu des sources.
const appDirs = new Set(await readdir(new URL('data/applications/', root)).catch(() => []));
for (const p of previous.jobs) {
  if ((p.status !== 'new' || appDirs.has(applicationFolder(p.id))) && !kept.some(k => k.id === p.id)) kept.push(p);
}
// Statut de candidature : déduit des dossiers data/applications/<id>/ (écrits par apply.mjs).
const exists = p => access(new URL(p, root)).then(() => true, () => false);
for (const j of kept) {
  const f = applicationFolder(j.id);
  if (appDirs.has(f)) { j.application = f; j.status = (await exists(`data/applications/${f}/envoi.json`)) ? 'sent' : 'ready'; }
}


// Salaire annuel (toujours affiché, « non indiqué » si l'offre ne le donne pas) et résumé rapide.
for (const j of kept) {
  j.salaryAnnual = annualSalary(j);
  const w = whoRecruits(j); j.viaAgency = w.viaAgency; j.viaPlatform = !!w.platform; j.recruiterWhy = w.why;
  j.reference = j.reference || offerReference(j);
  const prev = prevById.get(j.id);
  if (!j.summary) j.summary = prev?.summaryAi ? prev.summary : null;
  if (prev?.summaryAi && j.summary) j.summaryAi = true;
}
try {
  // Les plus pertinentes d'abord ; les autres seront résumées aux passages suivants (résumés conservés).
  const todo = kept.filter(j => !j.summaryAi).sort((a, b) => b.score - a.score).slice(0, 40);
  const ai = await aiSummaries(todo, process.env);
  for (const j of todo) if (ai[j.id]) { j.summary = ai[j.id]; j.summaryAi = true; }
  run.summaries = process.env.GEMINI_API_KEY ? `${Object.keys(ai).length} résumés IA` : 'résumés automatiques (sans IA)';
} catch (e) { run.summaries = `résumés automatiques (IA indisponible : ${e.message})`; }
for (const j of kept) if (!j.summary) j.summary = extractiveSummary(j.description);

kept.sort((a, b) => (a.status === 'new') - (b.status === 'new') || !!b.manual - !!a.manual || b.score - a.score);
const jobs = kept.slice(0, prefs.maxJobs || 200);

// Entreprises qui recrutent (candidatures spontanées), conservées séparément des offres.
if (prefs.sources?.laBonneBoite !== false) {
  try {
    const r = await laBonneBoite(prefs, process.env);
    if (Array.isArray(r)) {
      // Même zone géographique que pour les offres.
      const inZone = c => { const n = normalize(`${c.postcode} ${c.city}`); return !prefs.locations?.length || prefs.locations.some(l => hasPrefix(n, l)); };
      const before = r.length;
      r.splice(0, r.length, ...r.filter(inZone));
      if (before !== r.length) console.log(`laBonneBoite   ${before - r.length} entreprises hors zone écartées`);
      await mkdir(new URL('data/', root), { recursive: true });
      await writeFile(new URL('data/companies.json', root), JSON.stringify({ updatedAt: new Date().toISOString(), companies: r.slice(0, 300) }, null, 1));
      run.sources.laBonneBoite = `${r.length} entreprises`;
    } else run.sources.laBonneBoite = r.skipped;
  } catch (e) { run.sources.laBonneBoite = `erreur : ${e.message}`; }
  console.log(`${'laBonneBoite'.padEnd(14)} ${run.sources.laBonneBoite}`);
}

run.finishedAt = new Date().toISOString();
run.fetched = raw.length;
run.unique = unique.length;
run.kept = jobs.length;
run.zones = zones;
await mkdir(new URL('data/', root), { recursive: true });
await writeFile(new URL('data/jobs.json', root), JSON.stringify({ updatedAt: run.finishedAt, jobs }, null, 1));
await writeFile(new URL('data/run.json', root), JSON.stringify(run, null, 2));
console.log(`\n${raw.length} offres récupérées, ${unique.length} uniques, ${jobs.length} retenues (note ≥ ${prefs.minScore}).`);
