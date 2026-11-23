// Adaptation du CV à une offre — SANS MENTIR.
// Principe : le moteur ne crée aucun texte. Il choisit, parmi les éléments VRAIS du profil
// (titres, résumés, puces, compétences), ceux qui parlent le plus à l'offre, et les réordonne.
// honestyCheck() vérifie ensuite que chaque phrase du CV produit existe mot pour mot dans le profil.
import { normalize, hasTerm, tokens } from './text.mjs';
import { matchedSkills, skillTerms } from './match.mjs';

function relevance(item, normJob, jobTokens, normTitle = '') {
  const tagHits = (item.tags || []).filter(t => hasTerm(normJob, t)).length;
  const titleHits = (item.tags || []).filter(t => hasTerm(normTitle, t)).length;
  const words = new Set(tokens(item.text).filter(t => t.length > 3));
  let overlap = 0;
  for (const w of words) if (jobTokens.has(w)) overlap++;
  return titleHits * 6 + tagHits * 3 + overlap;
}

const best = (items, normJob, jobTokens, normTitle) =>
  items.map((it, i) => ({ it, i, r: relevance(it, normJob, jobTokens, normTitle) })).sort((a, b) => b.r - a.r || a.i - b.i)[0].it;

export function tailorCv(profile, job, opts = {}) {
  const maxBullets = opts.maxBullets ?? 9;
  const normJob = normalize(`${job.title}\n${(job.tags || []).join(' ')}\n${job.description}`);
  const jobTokens = new Set(tokens(normJob));

  const normTitle = normalize(job.title);
  const title = best(profile.titles, normJob, jobTokens, normTitle).text;
  const summary = best(profile.summaries, normJob, jobTokens, normTitle).text;

  // Puces : on garde les plus pertinentes (au moins une par expérience, ordre chronologique conservé).
  const scored = profile.experiences.flatMap((e, ei) =>
    e.bullets.map((b, bi) => ({ ei, bi, text: b.text, r: relevance(b, normJob, jobTokens) })));
  const keep = new Set();
  profile.experiences.forEach((_, ei) => {
    const top = scored.filter(s => s.ei === ei).sort((a, b) => b.r - a.r || a.bi - b.bi)[0];
    if (top) keep.add(`${ei}:${top.bi}`);
  });
  for (const s of [...scored].sort((a, b) => b.r - a.r)) {
    if (keep.size >= Math.max(maxBullets, profile.experiences.length)) break;
    if (s.r > 0) keep.add(`${s.ei}:${s.bi}`);
  }
  const experiences = profile.experiences.map((e, ei) => ({
    role: e.role, company: e.company, location: e.location, start: e.start, end: e.end,
    bullets: scored.filter(s => s.ei === ei && keep.has(`${ei}:${s.bi}`)).sort((a, b) => b.r - a.r || a.bi - b.bi)
      .map(s => ({ text: s.text, relevant: s.r > 0, score: s.r })),
  }))
    // Les expériences sans date (projets, activités annexes) ne figurent que si elles servent l'offre.
    .filter(e => e.start || Math.max(0, ...e.bullets.map(b => b.score)) >= 3);

  // Compétences : celles demandées par l'offre en premier (et mises en valeur), puis par niveau.
  const asked = new Set(matchedSkills(profile, normJob).map(s => s.name));
  const skills = [...profile.skills]
    .sort((a, b) => asked.has(b.name) - asked.has(a.name) || b.level - a.level)
    .slice(0, 14)
    .map(s => ({ name: s.name, level: s.level, matched: asked.has(s.name) }));

  // Transparence : compétences de l'offre que tu n'as PAS déclarées (jamais ajoutées au CV).
  const known = new Set(profile.skills.flatMap(skillTerms).map(normalize));
  const missing = (job.tags || []).filter(t => !known.has(normalize(t))).slice(0, 8);

  return {
    title, summary, experiences, skills,
    education: profile.education.map(({ degree, school, start, end }) => ({ degree, school, start, end })),
    languages: profile.languages,
    interests: profile.interests,
    matched: [...asked],
    missing,
  };
}

/** Renvoie la liste des textes du CV adapté qui n'existent pas mot pour mot dans le profil (doit être vide). */
export function honestyCheck(tailored, profile) {
  const truth = new Set();
  const walk = v => {
    if (typeof v === 'string') truth.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(profile);
  const problems = [];
  const check = s => { if (s && !truth.has(s)) problems.push(s); };
  check(tailored.title);
  check(tailored.summary);
  for (const e of tailored.experiences) {
    [e.role, e.company, e.location, e.start].forEach(check);
    if (e.end) check(e.end);
    e.bullets.forEach(b => check(b.text));
  }
  tailored.skills.forEach(s => check(s.name));
  tailored.education.forEach(e => [e.degree, e.school].forEach(check));
  return problems;
}

/** Détection simple de la langue de l'offre. */
export function detectLang(text) {
  const t = ` ${normalize(text).slice(0, 4000)} `;
  const count = ws => ws.reduce((a, w) => a + (t.split(` ${w} `).length - 1), 0);
  const fr = count(['le', 'la', 'les', 'des', 'et', 'vous', 'nous', 'pour', 'une', 'avec']);
  const en = count(['the', 'and', 'you', 'we', 'for', 'with', 'our', 'your', 'are', 'will']);
  const de = count(['und', 'die', 'der', 'wir', 'mit', 'sie', 'fur', 'das', 'ein', 'eine']);
  return fr >= en && fr >= de ? 'fr' : en >= de ? 'en' : 'de';
}
