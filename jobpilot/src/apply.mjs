// Étape 2 : prépare (et envoie si possible) la candidature pour une ou plusieurs offres.
// Usage : node src/apply.mjs <jobId> [<jobId> ...]
// Produit data/applications/<dossier>/ : cv.html, cv.pdf, lettre.html, lettre.txt, lettre.pdf, meta.json
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tailorCv, honestyCheck, detectLang } from './lib/tailor.mjs';
import { templateLetter, aiLetter, factCheck } from './lib/letter.mjs';
import { renderCv, renderLetter } from './lib/render.mjs';
import { applicationFolder } from './lib/text.mjs';

const run = promisify(execFile);
const root = new URL('..', import.meta.url);
const read = async p => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const env = process.env;

const ids = process.argv.slice(2).flatMap(a => a.split(/[\s,]+/)).filter(Boolean);
if (!ids.length) { console.error('Usage : node src/apply.mjs <jobId> [...]'); process.exit(1); }

const profile = await read('profile/profile.json');
const db = await read('data/jobs.json').catch(() => ({ jobs: [] }));
const companies = await read('data/companies.json').catch(() => null);

// Candidature spontanée : on construit une « offre » à partir de l'entreprise (La Bonne Boîte)
// et du métier visé. Le CV est adapté au métier, la lettre adopte un ton de candidature spontanée.
const ROME_TITLES = { D1402: 'Responsable grands comptes / Business developer', D1406: 'Directeur commercial — management de force de vente', M1707: 'Stratégie et développement commercial', M1302: 'Direction d\'entreprise / Directeur des opérations', N1301: 'Organisation de la chaîne logistique / Supply chain', M1805: 'Développement informatique' };
function spontaneousJob(c) {
  const title = ROME_TITLES[c.rome] || 'Candidature spontanée';
  return {
    id: c.id, spontaneous: true, source: 'La Bonne Boîte', title, company: c.name, location: [c.postcode, c.city].filter(Boolean).join(' '),
    remote: false, url: c.website || '', contactEmail: c.email || null, tags: [],
    description: `${title}. ${c.sector || ''}. Entreprise ${c.headcount || ''} à ${c.city || ''}. développement commercial direction commerciale business development management opérations`,
  };
}
const siteUrl = (env.SITE_URL || '').replace(/\/?$/, '/');

async function findChrome() {
  const candidates = [env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium'];
  for (const c of candidates.filter(Boolean)) {
    try { await access(c); return c; } catch {}
  }
  // Chromium de Playwright (dossier versionné)
  try {
    const { stdout } = await run('bash', ['-c', 'ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1']);
    if (stdout.trim()) return stdout.trim();
  } catch {}
  return null;
}

async function toPdf(chrome, htmlPath, pdfPath) {
  await run(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${fileURLToPath(pdfPath)}`, htmlPath.href], { timeout: 60000 });
}

async function sendMail({ to, subject, text, attachments }) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return 'SMTP non configuré';
  const { default: nodemailer } = await import('nodemailer');
  const t = nodemailer.createTransport({ host: env.SMTP_HOST, port: +(env.SMTP_PORT || 465), secure: (env.SMTP_PORT || '465') === '465', auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
  const from = `${profile.identity.firstName} ${profile.identity.lastName} <${env.SMTP_FROM || env.SMTP_USER}>`;
  // Les réponses des recruteurs et une copie de chaque envoi arrivent sur ta boîte principale (profil).
  await t.sendMail({ from, to, bcc: profile.identity.email || env.SMTP_USER, replyTo: profile.identity.email, subject, text, attachments });
  return 'envoyé';
}

const chrome = await findChrome();
const report = [];

for (const id of ids) {
  let job = db.jobs.find(j => j.id === id);
  if (!job && id.startsWith('lbb-')) {
    const c = companies?.companies?.find(x => x.id === id);
    if (c) job = spontaneousJob(c);
  }
  if (!job) { report.push({ id, error: 'offre introuvable dans data/jobs.json' }); continue; }

  const cv = tailorCv(profile, job);
  const lies = honestyCheck(cv, profile);
  if (lies.length) throw new Error(`Contrôle d'honnêteté échoué pour ${id} : ${lies.join(' | ')}`);

  const lang = detectLang(job.description);
  let letter = templateLetter(profile, job, cv);
  let letterSource = 'modèle (faits du profil uniquement)';
  try {
    const ai = await aiLetter(profile, job, cv, lang, env); // mode rapide : abandon en quelques secondes si Gemini est saturé
    if (ai) {
      const problems = factCheck(ai, profile, job);
      if (problems.length) letterSource = `modèle — lettre IA rejetée par le garde-fou (${problems.slice(0, 3).join(', ')})`;
      else { letter = ai; letterSource = `IA (${lang}), vérifiée par le garde-fou`; }
    }
  } catch (e) { letterSource = `modèle — IA indisponible (${e.message.slice(0, 80)})`; }

  // Un dossier par offre, nommé d'après son identifiant : plusieurs candidatures peuvent être préparées
  // en parallèle sans jamais modifier le même fichier (pas de conflit lors de l'enregistrement).
  const folder = applicationFolder(id);
  const dir = new URL(`data/applications/${folder}/`, root);
  await mkdir(dir, { recursive: true });
  const filmUrl = `${siteUrl || '../../'}cv3d/?pour=${encodeURIComponent(job.company)}`;
  // Le téléphone (secret CV_PHONE) n'apparaît que dans le PDF envoyé, jamais dans les pages publiques.
  const withPhone = env.CV_PHONE ? { ...profile, identity: { ...profile.identity, phone: env.CV_PHONE } } : profile;
  await writeFile(new URL('cv.html', dir), renderCv(withPhone, cv, { filmUrl, job }));
  await writeFile(new URL('lettre.html', dir), renderLetter(letter, profile));
  await writeFile(new URL('lettre.txt', dir), letter);

  let pdf = false;
  if (chrome) {
    try {
      await toPdf(chrome, new URL('cv.html', dir), new URL('cv.pdf', dir));
      await toPdf(chrome, new URL('lettre.html', dir), new URL('lettre.pdf', dir));
      pdf = true;
    } catch (e) { console.warn('PDF impossible :', e.message); }
  }
  if (withPhone !== profile) await writeFile(new URL('cv.html', dir), renderCv(profile, cv, { filmUrl, job }));

  // Envoi automatique uniquement quand l'offre donne une adresse e-mail de candidature.
  let sent = 'non — postuler via le lien de l\'offre';
  if (job.contactEmail && env.AUTO_SEND === 'true' && pdf) {
    const name = `${profile.identity.firstName} ${profile.identity.lastName}`;
    try {
      sent = await sendMail({
        to: job.contactEmail,
        subject: job.spontaneous ? `Candidature spontanée — ${name}` : `Candidature — ${job.title} — ${name}`,
        text: letter,
        attachments: [
          { filename: `CV - ${name}.pdf`, path: fileURLToPath(new URL('cv.pdf', dir)) },
          { filename: `Lettre de motivation - ${name}.pdf`, path: fileURLToPath(new URL('lettre.pdf', dir)) },
        ],
      });
    } catch (e) { sent = `échec de l'envoi : ${e.message}`; }
  } else if (job.contactEmail) {
    sent = env.AUTO_SEND === 'true' ? 'non — PDF indisponible' : `non — envoi auto désactivé (AUTO_SEND) ; e-mail : ${job.contactEmail}`;
  }

  const meta = { id, folder, auto: env.AUTO_MODE === '1', title: job.title, company: job.company, url: job.url, contactEmail: job.contactEmail, lang, letterSource, pdf, sent, matched: cv.matched, missing: cv.missing, createdAt: new Date().toISOString() };
  await writeFile(new URL('meta.json', dir), JSON.stringify(meta, null, 2));
  if (sent === 'envoyé') await writeFile(new URL('envoi.json', dir), JSON.stringify({ to: job.contactEmail, at: meta.createdAt }));
  report.push(meta);
  console.log(`✔ ${job.company} — ${job.title}\n  dossier : data/applications/${folder}\n  lettre : ${letterSource}\n  envoi : ${sent}`);
}

if (report.some(r => r.error)) { console.error(report.filter(r => r.error)); process.exitCode = 1; }
