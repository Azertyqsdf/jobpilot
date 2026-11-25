// Suivi des réponses : lit la boîte Gmail dédiée (où Outlook redirige les messages) et repère les réponses
// aux candidatures envoyées. Seuls les messages liés à une candidature sont analysés : même domaine que
// l'adresse de candidature, ou objet reprenant la candidature. Rien d'autre n'est lu ni enregistré.
// Résultat : data/replies.json { [idCandidature]: { kind, date, from, subject, extract } }.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const root = new URL('..', import.meta.url);
const read = async (p, d) => JSON.parse(await readFile(new URL(p, root), 'utf8').catch(() => JSON.stringify(d)));
const env = process.env;
if (!env.SMTP_USER || !env.SMTP_PASS || !/gmail\.com$/i.test(env.SMTP_USER)) { console.log('Lecture des réponses : boîte Gmail non configurée.'); process.exit(0); }

// Candidatures envoyées (avec l'adresse et la date d'envoi).
const sent = [];
for (const f of await readdir(new URL('data/applications/', root)).catch(() => [])) {
  const m = await read(`data/applications/${f}/meta.json`, null);
  if (m?.contactEmail && /envoy/.test(m.sent || '')) sent.push({ id: m.id, email: m.contactEmail.toLowerCase(), domain: m.contactEmail.split('@')[1].toLowerCase(), title: m.title, company: m.company, at: m.createdAt });
}
if (!sent.length) { console.log('Aucune candidature envoyée à suivre.'); process.exit(0); }

const PUBLIC = /^(gmail|googlemail|outlook|hotmail|live|yahoo|orange|wanadoo|free|sfr|laposte|bluewin|icloud|me)\./;
const AUTO = /(r[ée]ponse automatique|out of office|absence|auto(matic)?[- ]?reply|automatische antwort|je suis absent|i am out)/i;
function classify(text) {
  const t = text.toLowerCase();
  if (/(entretien|rencontrer|vous rencontrer|[ée]change t[ée]l[ée]phonique|vos disponibilit|cr[ée]neau|visio|rendez-vous|interview|call with you|meet you)/.test(t)) return 'entretien';
  if (/(ne (pas )?donner (une suite )?favorable|pas (été )?retenu|ne correspond pas|autre(s)? candidat|malheureusement|regret|nous ne pouvons pas|unfortunately|not (been )?selected|other candidates)/.test(t)) return 'refus';
  if (/(stabilisation des effectifs|pas de (poste|besoin|recrutement) (ouvert |en cours )?(actuellement|pour le moment|a ce jour)|aucun poste|conserv(er|ons|erons) (vos coordonn|votre (cv|candidature))|notre vivier|base de donn[ée]es candidats|pas en mesure de donner suite)/.test(t)) return 'vivier';
  if (/(bien re[çc]u|accus[ée] de r[ée]ception|nous avons re[çc]u|reviendrons vers vous|étudions votre candidature|thank you for your application|we have received)/.test(t)) return 'accuse';
  return 'reponse';
}

const profile = await read('profile/profile.json', {});
const MINE = new Set([env.SMTP_USER, profile.identity?.email].filter(Boolean).map(x => x.toLowerCase()));

/** Message transféré par toi (TR : / Fwd :) : retrouve l'expéditeur d'origine, l'objet et le texte du recruteur. */
function unwrapForward(text) {
  const m = text.match(/(?:^|\n)\s*(?:de|from|exp[ée]diteur)\s*:\s*([^\n]*)\n([\s\S]*)/i);
  if (!m) return null;
  const email = (m[1].match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [])[0];
  if (!email) return null;
  const rest = m[2];
  const subject = (rest.match(/(?:^|\n)\s*(?:objet|subject)\s*:\s*([^\n]*)/i) || [])[1] || '';
  // Le texte du recruteur commence après le bloc d'en-têtes (première ligne vide qui suit « Objet : »).
  const after = rest.split(/\n\s*(?:objet|subject)\s*:[^\n]*\n/i)[1] ?? rest;
  return { from: email.toLowerCase(), subject, body: after };
}

const replies = await read('data/replies.json', {});
const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, logger: false, socketTimeout: 120000 });
client.on('error', e => console.log(`Boîte mail : ${e.message}`)); // jamais de plantage du robot à cause de la boîte mail
setTimeout(() => { console.log('Lecture des réponses interrompue (trop longue).'); process.exit(0); }, 4 * 60 * 1000).unref();
let found = 0;
try {
  await client.connect();
  const since = new Date(Math.min(...sent.map(s => +new Date(s.at))) - 864e5);
  const lock = await client.getMailboxLock('INBOX');
  try {
    // On récupère d'abord la liste des messages, puis on les analyse : imapflow n'accepte pas
    // d'autre commande pendant qu'une lecture de liste est en cours (cause du blocage précédent).
    const list = [];
    for await (const m of client.fetch({ since }, { envelope: true, uid: true })) list.push({ uid: m.uid, envelope: m.envelope });
    for (const msg of list) {
      let from = (msg.envelope.from?.[0]?.address || '').toLowerCase();
      let subject = msg.envelope.subject || '';
      let body = null;
      if (!from) continue;
      if (MINE.has(from)) {
        // Envoyé par toi : on ne garde que les transferts (TR : / Fwd :) d'un message de recruteur.
        if (!/^\s*(tr|fw|fwd|transf[ée]r[ée])\s*:/i.test(subject)) continue;
        const raw = await client.fetchOne(msg.uid, { source: true }, { uid: true });
        const parsed = await simpleParser(raw.source);
        const fw = unwrapForward(parsed.text || '');
        if (!fw || MINE.has(fw.from)) continue;
        from = fw.from; subject = fw.subject || subject.replace(/^\s*(tr|fw|fwd)\s*:\s*/i, ''); body = fw.body;
      }
      const domain = from.split('@')[1] || '';
      // Lien avec une candidature : même adresse, même domaine (hors messageries grand public), ou objet repris.
      const app = sent.find(s => s.email === from)
        || (!PUBLIC.test(domain) && sent.find(s => s.domain === domain || domain.endsWith(`.${s.domain}`)))
        || sent.find(s => /candidature/i.test(subject) && subject.toLowerCase().includes(s.title.toLowerCase().slice(0, 25)));
      if (!app) continue; // message sans rapport avec une candidature : ignoré, rien n'est lu
      const date = (msg.envelope.date || new Date()).toISOString();
      if (new Date(date) < new Date(app.at)) continue;
      let text;
      if (body !== null) {
        text = `${subject}\n${body.split(/\n(?:le .{5,80} a écrit|on .{5,80} wrote)/i)[0]}`;
        if (AUTO.test(subject)) continue;
      } else {
        const full = await client.fetchOne(msg.uid, { source: true }, { uid: true });
        const parsed = await simpleParser(full.source);
        text = `${subject}\n${(parsed.text || '').split(/\n(?:le .{5,80} a écrit|on .{5,80} wrote|-----|de :|from:)/i)[0]}`;
        if (AUTO.test(subject) || parsed.headers.get('auto-submitted') && parsed.headers.get('auto-submitted') !== 'no') continue;
      }
      const kind = classify(text);
      const prev = replies[app.id];
      if (!prev || new Date(date) > new Date(prev.date)) {
        replies[app.id] = { kind, date, from, subject, extract: text.replace(/\s+/g, ' ').slice(0, 280) };
        found++;
        console.log(`📩 ${app.company} — ${kind} (${date.slice(0, 10)})`);
      }
    }
  } finally { lock.release(); }
  await client.logout();
} catch (e) {
  console.log(`Lecture des réponses impossible : ${e.message}`);
  process.exit(0);
}
await writeFile(new URL('data/replies.json', root), JSON.stringify(replies, null, 2));
const run = await read('data/run.json', {});
run.reponses = `${Object.keys(replies).length} réponse(s) suivie(s)${found ? `, ${found} nouvelle(s)` : ''}`;
await writeFile(new URL('data/run.json', root), JSON.stringify(run, null, 2));
console.log(run.reponses);
