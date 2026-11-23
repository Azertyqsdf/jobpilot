// Résumé rapide d'une offre (le détail complet reste accessible via « Voir l'offre »).
// Avec une clé Gemini : résumé rédigé par l'IA, par lots, uniquement à partir du texte de l'offre.
// Sans clé (ou en cas d'erreur) : résumé extractif — les phrases les plus parlantes de l'offre.
import { gemini } from './gemini.mjs';

const MISSION = /(vous (serez|aurez|êtes|intervenez|prenez|pilotez|managez|développez)|missions?|rattaché|responsable de|en charge|votre rôle|you will|you'll|your role|responsibilit|we are looking|nous recherchons|profil recherché|requirements|vous justifiez|expérience)/i;

export function extractiveSummary(text = '', max = 320) {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-ZÀ-ÝÉ•])/).map(s => s.replace(/^[•\-\s]+/, '').trim())
    .filter(s => s.length > 40 && s.length < 260);
  const ranked = sentences.map((s, i) => ({ s, i, w: (MISSION.test(s) ? 2 : 0) - i * 0.02 })).sort((a, b) => b.w - a.w);
  const picked = [];
  let len = 0;
  for (const { s, i } of ranked) {
    if (len + s.length > max) continue;
    picked.push({ s, i });
    len += s.length;
    if (picked.length >= 3) break;
  }
  return picked.sort((a, b) => a.i - b.i).map(p => p.s).join(' ') || text.slice(0, max);
}

export async function aiSummaries(jobs, env) {
  const key = env.GEMINI_API_KEY;
  if (!key || !jobs.length) return {};
  const out = {};
  for (let i = 0; i < jobs.length; i += 8) {
    const batch = jobs.slice(i, i + 8);
    const prompt = `Pour chaque offre d'emploi ci-dessous, écris un résumé en français de 2 à 3 phrases courtes (45 mots maximum) :
le poste et ses missions principales, le profil attendu, et un avantage notable s'il est mentionné.
N'utilise QUE les informations du texte de l'offre. N'invente rien. Ne mentionne pas le salaire (il est affiché à part).
Réponds uniquement en JSON : [{"id": "...", "resume": "..."}].

${batch.map(j => `### id: ${j.id}\nTitre : ${j.title}\nEntreprise : ${j.company}\nLieu : ${j.location}\n${j.description.slice(0, 3500)}`).join('\n\n')}`;
    const text = await gemini(prompt, env, { json: true, temperature: 0.2 }) || '[]';
    for (const r of JSON.parse(text.replace(/^```(json)?|```$/g, ''))) if (r?.id && r.resume) out[r.id] = String(r.resume).trim();
  }
  return out;
}
