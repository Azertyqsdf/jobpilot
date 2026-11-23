// Calcul de la pertinence d'une offre par rapport au profil et aux préférences.
import { normalize, hasTerm, hasPrefix, tokens } from './text.mjs';

export function skillTerms(skill) {
  return [skill.name, ...(skill.aliases || [])];
}

/** Compétences du profil présentes dans le texte de l'offre. */
export function matchedSkills(profile, normJobText) {
  return profile.skills.filter(s => skillTerms(s).some(t => hasTerm(normJobText, t)));
}

/** Mots-clés de l'offre (fréquents) — sert à expliquer la note et à surligner le CV. */
export function topJobKeywords(jobText, n = 25) {
  const counts = new Map();
  for (const t of tokens(jobText)) if (t.length > 2 && !/^\d+$/.test(t)) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

export function scoreJob(job, profile, prefs) {
  const normTitle = normalize(job.title);
  const normAll = normalize(`${job.title}\n${job.tags.join(' ')}\n${job.description}`);
  const reasons = [];

  if (prefs.exclude.some(x => hasPrefix(normTitle, x))) return { score: 0, excluded: 'mot exclu dans le titre', reasons };
  if (prefs.mustHave.length && !prefs.mustHave.some(x => hasPrefix(normAll, x))) return { score: 0, excluded: 'aucun mot obligatoire', reasons };

  // Une offre en télétravail réservée à une zone (« USA only ») n'est retenue que si la zone te convient.
  const locNorm = normalize(job.location);
  // Une offre peut lister plusieurs lieux (« Paris; Lyon; Annecy ») : il suffit qu'un des lieux soit dans ta zone.
  // Pour chaque lieu, seule la commune compte (« Saint-Priest, Lyon » = Saint-Priest, pas Lyon),
  // sauf les arrondissements (« 1er-Arrondissement, Lyon » = Lyon).
  const places = String(job.location || '').split(/;|\|/).map(seg => {
    const parts = seg.split(',').map(x => x.trim()).filter(Boolean);
    if (!parts.length) return '';
    return normalize(/arrondissement/i.test(parts[0]) && parts[1] ? parts[1] : parts[0]);
  }).filter(Boolean);
  const placeOk = places.some(pl => prefs.locations.some(l => hasPrefix(pl, l)));
  const genericRemote = job.remote && (!locNorm || /^(remote|remote job|anywhere|worldwide|werken op afstand|teletravail)$/.test(locNorm));
  const locOk = !prefs.locations.length || placeOk || (prefs.acceptRemote && genericRemote);
  if (!locOk) return { score: 0, excluded: `lieu hors zone (${job.location})`, reasons };

  if (prefs.maxAgeDays && job.postedAt) {
    const age = (Date.now() - new Date(job.postedAt)) / 864e5;
    if (age > prefs.maxAgeDays) return { score: 0, excluded: 'offre trop ancienne', reasons };
  }

  // 1) Compétences : part pondérée des compétences demandées que tu possèdes.
  const skills = matchedSkills(profile, normAll);
  const skillPts = skills.reduce((a, s) => a + s.level, 0);
  const skillScore = Math.min(1, skillPts / 14); // ~3 compétences fortes = plein score

  // 2) Titre : l'intitulé correspond-il à un de tes titres ?
  const titleHits = profile.titles.map(t => t.tags.filter(tag => hasTerm(normTitle, tag)).length);
  const titleScore = Math.min(1, Math.max(0, ...titleHits) / 2);

  // 3) Compétences présentes dans le titre de l'offre = cœur du poste.
  const titleSkill = profile.skills.some(s => skillTerms(s).some(t => hasTerm(normTitle, t))) ? 1 : 0;

  // 4) Préférences de requête
  const queryScore = prefs.queries.some(q => normalize(q).split(' ').every(w => hasPrefix(normAll, w.replace(/(eur|euse)$/, '')))) ? 1 : 0;

  // L'intitulé du poste compte plus que les mots de la description : un poste hors de ton métier est fortement pénalisé.
  const offTrack = !titleScore && !titleSkill && !queryScore;
  const score = Math.round(100 * (0.35 * skillScore + 0.4 * titleScore + 0.15 * titleSkill + 0.1 * queryScore) * (offTrack ? 0.5 : 1));
  if (skills.length) reasons.push(`Compétences : ${skills.map(s => s.name).join(', ')}`);
  if (titleScore) reasons.push('Intitulé proche de ton profil');
  if (job.remote) reasons.push('Télétravail possible');
  return { score, reasons, skills: skills.map(s => s.name) };
}
