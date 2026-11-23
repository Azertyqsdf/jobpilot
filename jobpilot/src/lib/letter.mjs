// Lettre de motivation. Par défaut : modèle construit uniquement à partir de faits du profil.
// Optionnel (gratuit) : si GEMINI_API_KEY est défini, l'IA reformule la lettre dans la langue de l'offre,
// puis un garde-fou rejette toute lettre contenant un chiffre ou un nom propre absent du profil / de l'offre.
import { normalize, hasTerm } from './text.mjs';

function pickMotivation(profile, job) {
  const n = normalize(`${job.title} ${job.description}`);
  const ms = profile.motivations || [];
  if (!ms.length) return null;
  return [...ms].sort((a, b) => b.tags.filter(t => hasTerm(n, t)).length - a.tags.filter(t => hasTerm(n, t)).length)[0].text;
}

export function templateLetter(profile, job, cv) {
  const { firstName, lastName, city, email, phone } = profile.identity;
  const proofs = cv.experiences.flatMap(e => e.bullets.filter(b => b.relevant).map(b => ({ ...b, company: e.company })))
    .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);
  const motivation = pickMotivation(profile, job);
  const skills = cv.matched.slice(0, 4);
  const lines = [
    `${firstName} ${lastName}`, city, email, phone, '',
    job.spontaneous ? 'Objet : candidature spontanée' : `Objet : candidature — ${job.title}`, '',
    'Madame, Monsieur,', '',
    job.spontaneous
      ? `Je me permets de vous adresser ma candidature spontanée : ${job.company} correspond au type d'entreprise dans laquelle je souhaite m'investir, et mon profil (${cv.title}) pourrait vous être utile.`
      : `Votre offre « ${job.title} » chez ${job.company} a retenu toute mon attention : elle correspond précisément à mon profil : ${cv.title}.`,
    '',
    skills.length && !job.spontaneous ? `Vous recherchez notamment des compétences en ${skills.join(', ')} ; voici ce que j'ai concrètement réalisé :` : 'Voici quelques réalisations concrètes :',
    ...proofs.map(p => `• ${p.text.replace(/\.$/, '')} (${p.company}).`),
    '',
    motivation ? `Ce qui me motive avant tout : ${motivation}. C'est ce que je viens chercher chez ${job.company}.` : `Je souhaite mettre cette expérience au service de ${job.company}.`,
    '',
    "Mon CV détaillé est joint ; vous y trouverez aussi un lien vers une version animée en 3D de mon parcours.",
    "Je suis disponible pour en échanger avec vous lors d'un entretien.",
    '',
    'Bien cordialement,',
    `${firstName} ${lastName}`,
  ];
  return lines.filter((l, i) => l !== undefined && !(i < 4 && !l)).join('\n');
}

/** Garde-fou anti-invention : chiffres et noms propres doivent exister dans le profil ou l'offre. */
export function factCheck(text, profile, job) {
  const source = normalize(`${JSON.stringify(profile)} ${job.title} ${job.company} ${job.location} ${job.description}`);
  const problems = [];
  for (const num of text.match(/\d+(?:[.,]\d+)?/g) || []) {
    if (!source.includes(num.replace(',', '.')) && !source.includes(num)) problems.push(`chiffre inconnu : ${num}`);
  }
  // Mots en majuscule qui ne sont pas en début de phrase/ligne.
  const re = /(?<![.!?:\n•]\s*)(?<=\S\s+)([A-ZÀ-Ý][\w.+#-]{2,})/g;
  const allowed = new Set(['madame', 'monsieur', 'dear', 'sir', 'madam', 'hiring', 'team', 'manager', 'cv', 'linkedin', 'github']);
  for (const m of text.matchAll(re)) {
    const w = normalize(m[1].replace(/[.\-]+$/, ""));
    if (!allowed.has(w) && !source.includes(w)) problems.push(`nom inconnu : ${m[1]}`);
  }
  return [...new Set(problems)];
}

export async function aiLetter(profile, job, cv, lang, env) {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  const model = env.GEMINI_MODEL || 'gemini-flash-latest';
  const langName = { fr: 'français', en: 'anglais', de: 'allemand' }[lang] || 'français';
  const facts = {
    identite: profile.identity, titre: cv.title, resume: cv.summary,
    experiences: cv.experiences, competences: cv.skills.map(s => s.name), formation: cv.education,
    langues: profile.languages, motivations: (profile.motivations || []).map(m => m.text),
  };
  const prompt = `Tu rédiges une lettre de motivation en ${langName}, 180 à 250 mots, ton sincère et direct, sans formules creuses.
RÈGLE ABSOLUE : n'utilise QUE les faits du JSON ci-dessous. N'invente aucun chiffre, aucune entreprise, aucune compétence, aucune expérience, aucun diplôme.
Si l'offre demande quelque chose qui n'est pas dans les faits, n'en parle pas. Tu peux traduire les faits fidèlement.
Mentionne en une phrase que le CV joint contient un lien vers une version animée en 3D du parcours.
Commence par l'objet, puis la formule d'appel, termine par la signature (prénom nom). Texte brut, pas de markdown.

FAITS (vrais) :
${JSON.stringify(facts, null, 1)}

OFFRE :
Titre : ${job.title}
Entreprise : ${job.company}
Lieu : ${job.location}
Description :
${job.description.slice(0, 6000)}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
  if (!text) throw new Error('Gemini : réponse vide');
  return text;
}
