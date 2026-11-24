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
  if (/(bien re[çc]u|accus[ée] de r[ée]ception|nous avons re[çc]u|reviendrons vers vous|étudions votre candidature|thank you for your application|we have received)/.test(t)) return 'accuse';
  return 'reponse';
}

const replies = await read('data/replies.json', {});
const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, logger: false });
let found = 0;
try {
  await client.connect();
  const since = new Date(Math.min(...sent.map(s => +new Date(s.at))) - 864e5);
  const lock = await client.getMailboxLock('INBOX');
  try {
    for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
      const from = (msg.envelope.from?.[0]?.address || '').toLowerCase();
      const subject = msg.envelope.subject || '';
      if (!from || from === env.SMTP_USER.toLowerCase()) continue;
      const domain = from.split('@')[1] || '';
      // Lien avec une candidature : même adresse, même domaine (hors messageries grand public), ou objet repris.
      const app = sent.find(s => s.email === from)
        || (!PUBLIC.test(domain) && sent.find(s => s.domain === domain || domain.endsWith(`.${s.domain}`)))
        || sent.find(s => /candidature/i.test(subject) && subject.toLowerCase().includes(s.title.toLowerCase().slice(0, 25)));
      if (!app) continue; // message sans rapport avec une candidature : ignoré, rien n'est lu
      const date = (msg.envelope.date || new Date()).toISOString();
      if (new Date(date) < new Date(app.at)) continue;
      const full = await client.fetchOne(msg.uid, { source: true }, { uid: true });
      const parsed = await simpleParser(full.source);
      const text = `${subject}\n${(parsed.text || '').split(/\n(?:le .{5,80} a écrit|on .{5,80} wrote|-----|de :|from:)/i)[0]}`;
      if (AUTO.test(subject) || parsed.headers.get('auto-submitted') && parsed.headers.get('auto-submitted') !== 'no') continue;
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
