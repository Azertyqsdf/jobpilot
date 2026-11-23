// Salaire annuel : on convertit tout ce qu'on trouve (fourchette fournie par la source, ou mention
// dans le texte de l'offre) en montant ANNUEL brut, sans jamais inventer : si rien n'est indiqué,
// on l'affiche clairement (« non indiqué »).

const HOURS = { EUR: 1607, CHF: 2080, USD: 2080, GBP: 1950 }; // heures travaillées par an
const CUR = [[/€|eur\b|euros?/i, 'EUR'], [/chf|fr\.?\s?suisses?/i, 'CHF'], [/\$|usd/i, 'USD'], [/£|gbp/i, 'GBP']];
const SYMBOL = { EUR: '€', CHF: 'CHF', USD: '$', GBP: '£' };

function currencyOf(t, fallback = null) {
  for (const [re, c] of CUR) if (re.test(t)) return c;
  return fallback;
}
function periodOf(t) {
  if (/(\/\s?h\b|hour|heure|horaire|hourly)/i.test(t)) return 'hour';
  if (/(\/\s?jour|par jour|daily|\/\s?day|per day|journalier|tjm)/i.test(t)) return 'day';
  if (/(mois|month|mensuel|monthly|\/\s?mo\b)/i.test(t)) return 'month';
  if (/(\ban\b|année|annuel|year|yearly|annual|\/\s?yr|p\.?a\.?\b|k€)/i.test(t)) return 'year';
  return null;
}
/** Montants présents dans un texte, en tenant compte de « 45 000 », « 45k », « 3.5k », « 45 000,00 ». */
function amounts(t) {
  const out = [];
  const re = /(\d{1,3}(?:[   .,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|K)?/g;
  let m;
  while ((m = re.exec(t))) {
    let raw = m[1];
    let v;
    if (/^\d{1,3}([   .,]\d{3})+$/.test(raw) && !/[.,]\d{1,2}$/.test(raw)) v = +raw.replace(/[^\d]/g, '');
    else v = +raw.replace(/[   ]/g, '').replace(',', '.');
    if (m[2]) v *= 1000;
    if (Number.isFinite(v) && v >= 7) out.push(v);
  }
  return out;
}

function toAnnual(v, period, currency, months = 12) {
  if (period === 'hour') return v * (HOURS[currency] || 1607);
  if (period === 'day') return v * 218;
  if (period === 'month') return v * months;
  return v;
}
function guessPeriod(v) { return v < 150 ? 'hour' : v < 1500 ? 'day' : v < 15000 ? 'month' : 'year'; }

function fromText(t, defaultCurrency) {
  const currency = currencyOf(t, defaultCurrency);
  const nums = amounts(t).filter(v => !(v >= 1900 && v <= 2100 && Number.isInteger(v) && !/k/i.test(t))); // écarte les années
  if (!nums.length || !currency) return null;
  const period = periodOf(t) || guessPeriod(Math.max(...nums));
  const months = /13\s*(mois|months)/i.test(t) ? 13 : 12;
  const vals = nums.slice(0, 2).map(v => toAnnual(v, period, currency, months));
  const min = Math.min(...vals), max = Math.max(...vals);
  if (min < 8000 || max > 1_000_000) return null; // valeurs aberrantes : on préfère ne rien afficher
  return { min: Math.round(min), max: Math.round(max), currency, from: period };
}

/** Cherche une mention de salaire dans la description (fenêtre autour d'un mot-clé + devise). */
function fromDescription(desc) {
  const re = /(salaire|rémunération|remuneration|salary|compensation|package|pay range|base|fixe|brut|gross|ote)[^\n]{0,140}/gi;
  let m;
  while ((m = re.exec(desc))) {
    const win = m[0];
    if (!currencyOf(win) && !/\d\s?k\b/i.test(win)) continue;
    if (!/\d/.test(win)) continue;
    const r = fromText(win, currencyOf(win) || 'EUR');
    if (r) return r;
  }
  return null;
}

export function annualSalary(job) {
  let r = null;
  let estimated = false;
  if (job.salaryMin) {
    r = { min: Math.round(job.salaryMin), max: Math.round(job.salaryMax || job.salaryMin), currency: job.salaryCurrency || 'EUR', from: 'year' };
    estimated = !!job.salaryPredicted;
  } else if (job.salary) {
    r = fromText(job.salary, currencyOf(job.salary, /France Travail|Adzuna/.test(job.source) ? 'EUR' : 'USD'));
  }
  if (!r && job.description) r = fromDescription(job.description);
  if (!r) return { label: 'Salaire annuel non indiqué', known: false };
  const k = v => (v >= 10000 ? `${Math.round(v / 1000)} k` : `${v}`);
  const sym = SYMBOL[r.currency] || r.currency;
  const range = r.min === r.max ? `${k(r.min)}${sym}` : `${k(r.min)}–${k(r.max)} ${sym}`;
  const note = estimated ? ' (estimation Adzuna)' : r.from !== 'year' ? ` (calculé depuis un montant ${{ hour: 'horaire', day: 'journalier', month: 'mensuel' }[r.from]})` : '';
  return { ...r, estimated, known: true, label: `${estimated ? '≈ ' : ''}${range} / an${note}` };
}
