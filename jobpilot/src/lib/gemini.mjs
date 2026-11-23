// Appel à Gemini (offre gratuite) avec nouvelles tentatives et modèles de repli :
// les erreurs 429 / 500 / 503 (surcharge) sont fréquentes sur l'offre gratuite.
const RETRY = new Set([429, 500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function gemini(prompt, env, { json = false, temperature = 0.3 } = {}) {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  const models = [...new Set([env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.0-flash'].filter(Boolean))];
  const errors = [];
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) } }),
        signal: AbortSignal.timeout(90000),
      }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
      if (res.ok) {
        const j = await res.json();
        const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
        if (text) return text;
        errors.push(`${model}: réponse vide`);
        break;
      }
      errors.push(`${model}: ${res.status}`);
      if (!RETRY.has(res.status)) break; // 400/403/404 : inutile d'insister sur ce modèle
      await sleep(2000 * (attempt + 1) ** 2);
    }
  }
  throw new Error(`Gemini indisponible (${[...new Set(errors)].slice(-3).join(', ')})`);
}
