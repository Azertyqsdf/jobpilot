// Qui publie l'offre : l'employeur lui-même, ou un cabinet / une agence qui recrute pour un client ?
// La lettre et l'objet du mail ne sont pas rédigés de la même façon dans les deux cas.
import { normalize } from './text.mjs';

// Cabinets et agences d'emploi connus (le nom publié est celui de l'intermédiaire, pas de l'employeur).
const KNOWN = /(michael page|page personnel|page executive|hays|robert walters|robert half|fed (finance|business|legal|supply|it|human)|expectra|manpower|adecco|randstad|synergie|proman|crit|start people|samsic emploi|partnaire|leader interim|actual|gojob|staffmatch|uptoo|skaelia|talents? (commerciaux|executive)|findyourstaff|hunteed|hirsch|walters people|spring|kelly services|lhh|harvey nash|grafton|morgan philips|keljob|externatic|altaide|cadremploi|fed group|nextep|vitalians|adsearch|karpos|potentiel|atypique|mercato de l.emploi|de graet|pepite conseil|m&j|recrutement|interim|executive search|search partners|consulting rh|\brh\b)/;
const AGENCY_TEXT = /(notre client|nos clients|pour le compte d[e'u ]|pour l.un de nos clients|client final|cabinet de recrutement|cabinet specialise|nous recrutons pour|mission de recrutement|en partenariat avec notre client|agence d.emploi|agence d.interim|chasse de tetes|chasseur de tetes|executive search)/;

// Sites d'annonces : le nom affiché est celui du site, l'employeur n'est pas connu.
const PLATFORM = /^(france travail|pole emploi|direct emploi|job-?room|free-?work|hellowork|indeed|monster|cadremploi|apec|regionsjob|meteojob|keljob|jobijoba|jobteaser|welcome to the jungle|jobs\.ch|jobup|optioncarriere|staffsante|emploi lr|jobintree)$/;

/** @returns {{ viaAgency: boolean, platform?: boolean, why: string }} */
export function whoRecruits(job, { isRecruiterSite = false } = {}) {
  const company = normalize(job.company || '');
  if (PLATFORM.test(company)) {
    const t = normalize(`${job.title} ${job.description || ''}`);
    return AGENCY_TEXT.test(t) ? { viaAgency: true, why: "l'annonce indique un recrutement pour un client" } : { viaAgency: false, platform: true, why: "publiée sur un site d'annonces, employeur non nommé" };
  }
  const text = normalize(`${job.title} ${job.description || ''}`);
  if (AGENCY_TEXT.test(text)) return { viaAgency: true, why: "l'annonce indique un recrutement pour un client" };
  if (KNOWN.test(company)) return { viaAgency: true, why: 'cabinet / agence de recrutement connu' };
  if (isRecruiterSite) return { viaAgency: true, why: 'le site de l\'annonceur présente un cabinet de recrutement' };
  return { viaAgency: false, why: 'employeur direct' };
}

/** Référence de l'annonce (à rappeler dans l'objet du mail), si elle figure dans le texte. */
export function offerReference(job) {
  const m = String(job.description || '').match(/r[ée]f(?:[ée]rence)?(?:\s+de l.offre)?\s*[.:n°#]*\s*([A-Z0-9][A-Z0-9_\-/.]{3,24})/i);
  return m && /\d/.test(m[1]) ? m[1].replace(/[.,;]$/, '') : null;
}
