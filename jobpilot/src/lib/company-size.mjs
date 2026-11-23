// Taille et activité d'une entreprise française d'après l'annuaire public des entreprises
// (recherche-entreprises.api.gouv.fr — gratuit, sans clé). Sert à juger si l'adresse « contact » est pertinente.
import { normalize } from './text.mjs';

// Codes INSEE de tranche d'effectif salarié → effectif minimum de la tranche.
const TRANCHE_MIN = { '00': 0, '01': 1, '02': 3, '03': 6, '11': 10, '12': 20, '21': 50, '22': 100, '31': 200, '32': 250, '41': 500, '42': 1000, '51': 2000, '52': 5000, '53': 10000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function companyInfo({ name, siret, postcode }) {
  const siren = siret ? String(siret).replace(/\D/g, '').slice(0, 9) : null;
  const q = siren || name;
  if (!q) return null;
  await sleep(250); // l'annuaire accepte ~7 requêtes par seconde
  try {
    const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=5`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const { results = [] } = await res.json();
    const want = normalize(name || '').replace(/[^a-z0-9]+/g, ' ').trim();
    const hit = results.find(r => siren && r.siren === siren)
      || results.find(r => {
        const n = normalize(`${r.nom_complet} ${r.nom_raison_sociale || ''} ${r.sigle || ''}`).replace(/[^a-z0-9]+/g, ' ');
        return want && (` ${n} `).includes(` ${want} `) && (!postcode || !r.siege?.code_postal || r.siege.code_postal.slice(0, 2) === String(postcode).slice(0, 2) || true);
      });
    if (!hit) return null;
    const code = hit.tranche_effectif_salarie;
    return {
      siren: hit.siren, name: hit.nom_complet, naf: hit.activite_principale || '',
      employeesMin: code && code in TRANCHE_MIN ? TRANCHE_MIN[code] : null, // null = non renseigné (fréquent pour les petites structures)
    };
  } catch { return null; }
}

/**
 * L'adresse générale (contact@…) d'une entreprise est-elle un bon canal de candidature ?
 * Oui pour une petite structure (moins de 50 salariés) ou un cabinet de recrutement / agence d'emploi
 * de moins de 100 salariés : l'adresse est lue par les personnes qui recrutent.
 * Non pour une entreprise plus grande : elle mène presque toujours au service client.
 */
export function genericContactVerdict({ info, isRecruiter, lbbHeadcount }) {
  const lbbMin = parseInt(String(lbbHeadcount || '').replace(/\s/g, '').match(/\d+/)?.[0] || '', 10);
  const size = Number.isFinite(lbbMin) ? lbbMin : info?.employeesMin ?? null;
  const recruiterNaf = /^78\./.test(info?.naf || ''); // 78 = activités liées à l'emploi (placement, intérim)
  const recruiter = isRecruiter || recruiterNaf;
  if (size !== null && size >= 100) return { ok: false, why: `grande entreprise (${size}+ salariés) : adresse générale probablement du service client` };
  if (size !== null && size < 50) return { ok: true, why: `petite entreprise (${size === 0 ? 'moins de 10' : `${size} à ${size < 10 ? 9 : size < 20 ? 19 : 49}`} salariés)` };
  if (recruiter) return { ok: true, why: `cabinet de recrutement${size !== null ? ` (${size}+ salariés)` : ''} : l'adresse est lue par les recruteurs` };
  return { ok: false, why: 'taille inconnue et activité hors recrutement : on préfère ne pas écrire à l\'adresse générale' };
}
