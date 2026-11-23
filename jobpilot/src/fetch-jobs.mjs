// Étape 1 : récupère les offres sur toutes les sources, les note et garde les plus pertinentes.
// Usage : node src/fetch-jobs.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { SOURCES } from './sources/index.mjs';
import { scoreJob } from './lib/match.mjs';
import { laBonneBoite } from './sources/labonneboite.mjs';

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

// Dédoublonnage (même entreprise + même titre).
const seen = new Set();
const unique = raw.filter(j => {
  const k = `${j.company}|${j.title}`.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const kept = [];
for (const job of unique) {
  const s = scoreJob(job, profile, prefs);
  if (s.excluded || s.score < prefs.minScore) continue;
  const prev = prevById.get(job.id);
  kept.push({ ...job, description: job.description.slice(0, 12000), score: s.score, reasons: s.reasons, matchedSkills: s.skills, status: prev?.status || 'new', firstSeen: prev?.firstSeen || run.startedAt });
}

// On conserve les offres déjà traitées (postulées / candidatures prêtes) même si elles ont disparu des sources.
for (const p of previous.jobs) {
  if (p.status !== 'new' && !kept.some(k => k.id === p.id)) kept.push(p);
}

kept.sort((a, b) => (a.status === 'new') - (b.status === 'new') || b.score - a.score);
const jobs = kept.slice(0, prefs.maxJobs || 200);

// Entreprises qui recrutent (candidatures spontanées), conservées séparément des offres.
if (prefs.sources?.laBonneBoite !== false) {
  try {
    const r = await laBonneBoite(prefs, process.env);
    if (Array.isArray(r)) {
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
await mkdir(new URL('data/', root), { recursive: true });
await writeFile(new URL('data/jobs.json', root), JSON.stringify({ updatedAt: run.finishedAt, jobs }, null, 1));
await writeFile(new URL('data/run.json', root), JSON.stringify(run, null, 2));
console.log(`\n${raw.length} offres récupérées, ${unique.length} uniques, ${jobs.length} retenues (note ≥ ${prefs.minScore}).`);
