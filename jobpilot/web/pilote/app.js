// JobPilot — interface de pilotage.
// Tout passe par l'API GitHub avec TON jeton personnel (gardé uniquement dans ce navigateur) :
// lecture des offres, suivi des candidatures, édition du profil et des préférences,
// enregistrement chiffré des clés (secrets), lancement du robot.
import nacl from 'https://cdn.jsdelivr.net/npm/tweetnacl@1.0.3/+esm';
import { blake2b } from 'https://cdn.jsdelivr.net/npm/blakejs@1.2.1/+esm';

// ------------------------------------------------------------------ utilitaires
const $ = s => document.querySelector(s);
const view = $('#view');
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const fmtDay = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '';
const fmtWhen = d => d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const daysSince = d => d ? (Date.now() - new Date(d)) / 864e5 : 0;
const b64enc = s => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const bytesFromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64FromBytes = u => { let bin = ''; for (const b of u) bin += String.fromCharCode(b); return btoa(bin); };

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${isErr ? ' err' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), isErr ? 6000 : 3200);
}
function sync(state) { $('#sync').className = `sync ${state}`; }

// Chiffrement « sealed box » (libsodium) exigé par GitHub pour les secrets.
function seal(text, publicKeyB64) {
  const pk = bytesFromB64(publicKeyB64);
  const ek = nacl.box.keyPair();
  const both = new Uint8Array(64); both.set(ek.publicKey); both.set(pk, 32);
  const nonce = blake2b(both, undefined, 24);
  const boxed = nacl.box(new TextEncoder().encode(text), nonce, pk, ek.secretKey);
  const out = new Uint8Array(32 + boxed.length); out.set(ek.publicKey); out.set(boxed, 32);
  return b64FromBytes(out);
}

// ------------------------------------------------------------------ configuration & état
const LS = 'jobpilot.cfg.v1';
function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  return m ? { owner: m[1], repo: location.pathname.split('/').filter(Boolean)[0] || '' } : { owner: '', repo: '' };
}
let cfg = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
cfg = { ...guessRepo(), dir: 'jobpilot', ...cfg };
const saveCfg = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch {} };

const S = {
  branch: null, jobs: [], companies: [], apps: {}, updatedAt: null, run: {}, tracking: { apps: {} }, profile: null, prefs: null,
  sha: {}, secrets: [], vars: {}, runs: [], loaded: false, errors: {},
};
let tab = (location.hash.slice(1) || 'offres');
let draft = null;      // copie en cours d'édition (profil ou recherche)
let dirty = null;      // 'profile' | 'prefs'
let picked = new Set();
let filters = { q: '', status: 'new', min: 0 };

// ------------------------------------------------------------------ API GitHub
async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).message || msg; } catch {}
    const e = new Error(msg); e.status = res.status; throw e;
  }
  if (raw) return res;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
const R = p => `/repos/${cfg.owner}/${cfg.repo}${p}`;
const P = p => `${cfg.dir ? cfg.dir.replace(/\/$/, '') + '/' : ''}${p}`;

async function readJson(path) {
  try {
    const meta = await gh(R(`/contents/${encodeURI(P(path))}?ref=${S.branch}`));
    const text = meta.content && meta.encoding === 'base64'
      ? b64dec(meta.content)
      : await (await gh(R(`/contents/${encodeURI(P(path))}?ref=${S.branch}`), { raw: true })).text();
    S.sha[path] = meta.sha;
    return JSON.parse(text);
  } catch (e) {
    if (e.status === 404) { S.sha[path] = null; return null; }
    throw e;
  }
}
async function writeJson(path, data, message) {
  const body = { message, content: b64enc(JSON.stringify(data, null, 2) + '\n'), branch: S.branch };
  if (S.sha[path]) body.sha = S.sha[path];
  const r = await gh(R(`/contents/${encodeURI(P(path))}`), { method: 'PUT', body });
  S.sha[path] = r.content.sha;
}
async function downloadFile(path, filename) {
  sync('busy');
  try {
    const res = await gh(R(`/contents/${encodeURI(P(path))}?ref=${S.branch}`), { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    sync('ok');
  } catch (e) { sync('err'); toast(`Téléchargement impossible : ${e.message}`, true); }
}
// Aperçu d'un document de candidature dans l'interface (lisible sur téléphone).
async function preview(path) {
  sync('busy');
  try {
    const html = await (await gh(R(`/contents/${encodeURI(P(path))}?ref=${S.branch}`), { raw: true })).text();
    const box = Object.assign(document.createElement('div'), { className: 'preview' });
    box.innerHTML = `<div class="preview-bar"><b>Aperçu</b><button class="btn sm" type="button">Fermer ✕</button></div>`;
    const frame = Object.assign(document.createElement('iframe'), { srcdoc: html, title: 'Aperçu' });
    box.appendChild(frame);
    box.querySelector('button').onclick = () => { box.remove(); document.body.style.overflow = ''; };
    document.body.appendChild(box); document.body.style.overflow = 'hidden';
    sync('ok');
  } catch (e) { sync('err'); toast(`Aperçu impossible : ${e.message}`, true); }
}
async function dispatch(applyIds = [], send = false) {
  await gh(R('/actions/workflows/jobpilot.yml/dispatches'), { method: 'POST', body: { ref: S.branch, inputs: { apply: applyIds.join(' '), send: String(send) } } });
  watchRobot();
}

// ------------------------------------------------------------------ chargement
async function loadAll() {
  sync('busy');
  S.errors = {};
  try {
    const repo = await gh(R(''));
    S.branch = repo.default_branch;
    S.canPush = repo.permissions?.push !== false;
  } catch (e) {
    sync('err');
    if (e.status === 401 || e.status === 403 || e.status === 404) { renderLogin(`Connexion refusée par GitHub (${e.message}). Vérifie le jeton et le nom du dépôt.`); return false; }
    throw e;
  }
  const part = async (name, fn) => { try { await fn(); } catch (e) { S.errors[name] = e.message; } };
  await Promise.all([
    part('jobs', async () => { const j = await readJson('data/jobs.json'); S.jobs = j?.jobs || []; S.updatedAt = j?.updatedAt; }),
    part('run', async () => { S.run = (await readJson('data/run.json')) || {}; }),
    part('companies', async () => { S.companies = (await readJson('data/companies.json'))?.companies || []; }),
    part('tracking', async () => { S.tracking = (await readJson('data/tracking.json')) || { apps: {} }; S.tracking.apps ||= {}; }),
    part('profile', async () => { S.profile = await readJson('profile/profile.json'); }),
    part('prefs', async () => { S.prefs = await readJson('profile/preferences.json'); }),
    part('secrets', async () => { S.secrets = (await gh(R('/actions/secrets?per_page=100'))).secrets.map(s => s.name); }),
    part('vars', async () => { S.vars = Object.fromEntries((await gh(R('/actions/variables?per_page=100'))).variables.map(v => [v.name, v.value])); }),
    part('runs', loadRuns),
    part('apps', loadApplications),
  ]);
  S.loaded = true;
  sync(Object.keys(S.errors).length ? 'err' : 'ok');
  return true;
}
// Dossiers de candidature présents dans le dépôt (un appel) : data/applications/<id>/, envoi.json si l'e-mail est parti.
const appFolder = id => String(id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
async function loadApplications() {
  const tree = await gh(R(`/git/trees/${S.branch}?recursive=1`));
  const prefix = P('data/applications/');
  const apps = {};
  for (const t of tree.tree || []) {
    if (!t.path.startsWith(prefix)) continue;
    const [folder, file] = t.path.slice(prefix.length).split('/');
    apps[folder] ||= { folder, sent: false, ready: false };
    if (file === 'envoi.json') apps[folder].sent = true;
    if (file === 'cv.pdf') apps[folder].ready = true;
  }
  S.apps = apps;
}
async function loadRuns() {
  S.runs = (await gh(R('/actions/workflows/jobpilot.yml/runs?per_page=8'))).workflow_runs;
}

let robotTimer = null;
function watchRobot() {
  clearInterval(robotTimer);
  const started = Date.now();
  sync('busy');
  robotTimer = setInterval(async () => {
    try {
      await loadRuns();
      const active = S.runs.some(r => r.status !== 'completed');
      if (tab === 'robot') render();
      if (!active && Date.now() - started > 20000) {
        clearInterval(robotTimer);
        const last = S.runs[0];
        const j = await readJson('data/jobs.json');
        S.jobs = j?.jobs || S.jobs; S.updatedAt = j?.updatedAt || S.updatedAt;
        S.run = (await readJson('data/run.json')) || S.run;
        S.companies = (await readJson('data/companies.json'))?.companies || S.companies;
        await loadApplications().catch(() => {});
        sync(last?.conclusion === 'success' ? 'ok' : 'err');
        toast(last?.conclusion === 'success' ? 'Le robot a terminé ✔' : 'Le robot a rencontré une erreur — voir l\'onglet Robot', last?.conclusion !== 'success');
        render();
      }
    } catch { /* réessaie au prochain tour */ }
  }, 8000);
}

// ------------------------------------------------------------------ suivi des candidatures
const STAGES = [
  { id: 'a_envoyer', label: 'À envoyer' },
  { id: 'envoyee', label: 'Envoyée' },
  { id: 'entretien', label: 'Entretien' },
  { id: 'terminee', label: 'Terminée' },
];
const STAGE_OPTIONS = [
  ['preparation', 'En préparation par le robot'], ['a_envoyer', 'À envoyer'], ['envoyee', 'Envoyée'], ['relancee', 'Relancée'],
  ['entretien', 'Entretien prévu'], ['offre', '🎉 Offre reçue'], ['refus', 'Refus'], ['abandon', 'Abandonnée'],
];
const jobById = id => S.jobs.find(j => j.id === id) || companyJob(S.companies.find(c => c.id === id));
const companyJob = c => c && { id: c.id, title: 'Candidature spontanée', company: c.name, url: c.website || '', location: c.city, status: 'new' };
function effective(id, a) {
  const job = jobById(id);
  let stage = a.stage;
  const app = S.apps?.[appFolder(id)];
  if (stage === 'preparation' && app?.ready) stage = 'a_envoyer';
  if (['preparation', 'a_envoyer'].includes(stage) && app?.sent) stage = 'envoyee';
  const column = { preparation: 'a_envoyer', a_envoyer: 'a_envoyer', envoyee: 'envoyee', relancee: 'envoyee', entretien: 'entretien', offre: 'terminee', refus: 'terminee', abandon: 'terminee' }[stage] || 'a_envoyer';
  const sentAt = a.sentAt || (app?.sent ? (a.mailAt || a.at) : null);
  const due = (stage === 'envoyee' && daysSince(sentAt) >= 7) || (stage === 'relancee' && daysSince(a.relanceAt) >= 10);
  return { stage, column, job, sentAt, due, folder: app?.ready ? app.folder : null };
}
// Suivi = entrées enregistrées + candidatures faites automatiquement par le robot (pas encore dans le suivi).
function activeApps() {
  const list = Object.entries(S.tracking.apps).filter(([, a]) => a.stage !== 'ignoree');
  const known = new Set(Object.keys(S.tracking.apps).map(appFolder));
  for (const j of [...S.jobs, ...S.companies.map(companyJob)]) {
    const app = S.apps?.[appFolder(j.id)];
    if (!app || known.has(appFolder(j.id))) continue;
    known.add(appFolder(j.id));
    list.push([j.id, { auto: true, stage: app.sent ? 'envoyee' : 'a_envoyer', title: j.title, company: j.company, url: j.url, at: j.firstSeen || S.updatedAt }]);
  }
  return list;
}
const dueCount = () => activeApps().filter(([id, a]) => effective(id, a).due).length;

let trackTimer = null;
function saveTracking(delay = 0) {
  clearTimeout(trackTimer);
  trackTimer = setTimeout(async () => {
    sync('busy');
    try {
      await writeJson('data/tracking.json', S.tracking, 'JobPilot : suivi des candidatures [skip ci]');
      sync('ok');
    } catch (e) {
      if (e.status === 409 || e.status === 422) { // le fichier a changé ailleurs : on fusionne et on réessaie
        const remote = (await readJson('data/tracking.json')) || { apps: {} };
        S.tracking.apps = { ...remote.apps, ...S.tracking.apps };
        return saveTracking();
      }
      sync('err'); toast(`Suivi non enregistré : ${e.message}`, true);
    }
  }, delay);
}
function track(id, patch) {
  const job = jobById(id);
  const prev = S.tracking.apps[id] || { at: new Date().toISOString(), title: job?.title, company: job?.company, url: job?.url, location: job?.location };
  S.tracking.apps[id] = { ...prev, ...patch, updatedAt: new Date().toISOString() };
}

// ------------------------------------------------------------------ rendu général
const TABS = [
  ['offres', 'Offres'], ['entreprises', 'Entreprises'], ['suivi', 'Suivi'], ['profil', 'Mon profil'], ['recherche', 'Recherche'], ['cles', 'Clés & envoi'], ['robot', 'Robot'], ['compte', 'Connexion'],
];
function renderTabs() {
  const fresh = S.jobs.filter(j => j.status === 'new' && !S.tracking.apps[j.id]).length;
  const badges = { offres: fresh, suivi: dueCount() };
  $('#tabs').innerHTML = TABS.map(([id, label]) =>
    `<button role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}${badges[id] ? `<span class="badge">${badges[id]}</span>` : ''}</button>`).join('');
}
function render() {
  if (!cfg.token) return renderLogin();
  if (!S.loaded) return;
  renderTabs();
  const fn = { offres: viewOffers, entreprises: viewCompanies, suivi: viewTracking, profil: viewProfile, recherche: viewPrefs, cles: viewKeys, robot: viewRobot, compte: viewAccount }[tab] || viewOffers;
  view.innerHTML = fn();
  $('#savebar').hidden = !dirty;
}
function go(t) {
  if (dirty && !confirm('Des modifications ne sont pas enregistrées. Les abandonner ?')) return;
  if (dirty) { dirty = null; draft = null; }
  tab = t; filters.q = ''; location.hash = t; window.scrollTo(0, 0); render();
}

// ------------------------------------------------------------------ connexion
function tokenUrl() {
  const q = new URLSearchParams({
    name: 'JobPilot', description: 'Interface JobPilot', expires_in: '366',
    contents: 'write', actions: 'write', secrets: 'write', actions_variables: 'write', metadata: 'read',
  });
  if (cfg.owner) q.set('target_name', cfg.owner);
  return `https://github.com/settings/personal-access-tokens/new?${q}`;
}
function renderLogin(error = '') {
  $('#tabs').innerHTML = '';
  $('#savebar').hidden = true;
  view.innerHTML = `<div class="login card">
    <h2>Bienvenue dans JobPilot</h2>
    <p class="muted">Pour que cette interface puisse lire tes offres, enregistrer ton profil et lancer le robot, elle a besoin d'une clé d'accès à ton dépôt GitHub. Tu ne la crées qu'une fois ; elle reste dans ce navigateur.</p>
    <ol>
      <li>Ouvre <a href="${esc(tokenUrl())}" target="_blank" rel="noopener">la page de création de jeton GitHub</a>.</li>
      <li><b>Repository access</b> : « Only select repositories » → choisis ton dépôt JobPilot.</li>
      <li><b>Permissions</b> (si elles ne sont pas déjà cochées) : <i>Contents</i>, <i>Actions</i>, <i>Secrets</i> et <i>Variables</i> en « Read and write ».</li>
      <li>Clique sur <b>Generate token</b>, copie-le et colle-le ci-dessous.</li>
    </ol>
    ${error ? `<p class="small" style="color:var(--bad)">${esc(error)}</p>` : ''}
    <form id="loginForm" class="stack">
      <div class="grid2">
        <label class="field"><span>Compte GitHub</span><input type="text" name="owner" value="${esc(cfg.owner)}" required autocomplete="off"></label>
        <label class="field"><span>Dépôt</span><input type="text" name="repo" value="${esc(cfg.repo)}" required autocomplete="off"></label>
      </div>
      <label class="field"><span>Jeton (commence par github_pat_)</span><input type="password" name="token" required autocomplete="off"></label>
      <details><summary>Avancé</summary><label class="field" style="margin-top:8px"><span>Dossier JobPilot dans le dépôt</span><input type="text" name="dir" value="${esc(cfg.dir)}"></label></details>
      <button class="btn primary" type="submit">Se connecter</button>
    </form>
  </div>`;
}

// ------------------------------------------------------------------ Offres
function viewOffers() {
  const tracked = new Set(Object.keys(S.tracking.apps));
  const ignored = new Set(Object.entries(S.tracking.apps).filter(([, a]) => a.stage === 'ignoree').map(([id]) => id));
  const list = S.jobs.filter(j => {
    if (filters.status === 'new' && (tracked.has(j.id) || j.status !== 'new' || S.apps?.[appFolder(j.id)])) return false;
    if (filters.status === 'ignored' && !ignored.has(j.id)) return false;
    if (filters.status === 'all' && ignored.has(j.id)) return false;
    if (j.score < filters.min) return false;
    if (filters.q && !`${j.title} ${j.company} ${j.location}`.toLowerCase().includes(filters.q.toLowerCase())) return false;
    return true;
  });
  const apps = activeApps().map(([id, a]) => effective(id, a));
  const stats = [
    [S.jobs.length, 'offres retenues'],
    [S.jobs.filter(j => j.status === 'new' && !tracked.has(j.id)).length, 'à examiner'],
    [apps.filter(a => ['envoyee', 'relancee'].includes(a.stage)).length, 'candidatures envoyées'],
    [apps.filter(a => a.stage === 'entretien').length, 'entretiens'],
  ];
  const sources = Object.entries(S.run.sources || {}).map(([k, v]) => `${k} : ${v}`).join(' · ');
  return `<div class="head"><div><h2>Offres</h2><div class="muted small">Mises à jour ${S.updatedAt ? fmtWhen(S.updatedAt) : '—'} · le robot passe chaque matin</div></div>
    <div class="row"><a class="btn sm ghost" href="../" target="_blank">Mon CV</a><a class="btn sm ghost" href="../cv3d/" target="_blank">Mon film 3D</a><button class="btn sm" data-act="search-now">↻ Chercher maintenant</button></div></div>
  <div class="stats">${stats.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('')}</div>
  <div class="toolbar">
    <input type="search" id="q" placeholder="Filtrer : titre, entreprise, ville…" value="${esc(filters.q)}">
    <select id="fstatus"><option value="new"${filters.status === 'new' ? ' selected' : ''}>À examiner</option><option value="all"${filters.status === 'all' ? ' selected' : ''}>Toutes</option><option value="ignored"${filters.status === 'ignored' ? ' selected' : ''}>Ignorées</option></select>
    <select id="fmin">${[0, 50, 60, 70, 80].map(v => `<option value="${v}"${filters.min === v ? ' selected' : ''}>${v ? `Note ≥ ${v}` : 'Toutes notes'}</option>`).join('')}</select>
    <button class="btn primary" data-act="apply-picked" ${picked.size ? '' : 'disabled'}>Postuler à la sélection (${picked.size})</button>
  </div>
  ${list.length ? list.map(jobCard).join('') : `<div class="card center muted">${S.jobs.length ? 'Aucune offre avec ces filtres.' : 'Aucune offre pour le moment : lance une recherche avec « Chercher maintenant ».'}</div>`}
  ${sources ? `<p class="muted small" style="margin-top:18px">Sources du dernier passage — ${esc(sources)}</p>` : ''}`;
}
function jobCard(j) {
  const a = S.tracking.apps[j.id];
  const isIgnored = a?.stage === 'ignoree';
  const inTrack = (a && !isIgnored) || !!S.apps?.[appFolder(j.id)];
  return `<article class="card job">
    <div class="score" style="--s:${j.score}">${j.score}</div>
    <div class="body">
      <h3>${esc(j.title)}</h3>
      <div class="meta">${esc(j.company)} · ${esc(j.location || '—')}${j.remote ? ' · télétravail' : ''}${j.contract ? ` · ${esc(j.contract)}` : ''} · ${esc(j.source)} · ${fmtDay(j.postedAt)}${j.contactEmail ? ' · ✉️ candidature par e-mail' : ''}</div>
      <div class="salary${j.salaryAnnual?.known ? '' : ' unknown'}">💰 ${esc(j.salaryAnnual?.label || 'Salaire annuel non indiqué')}</div>
      <p class="summary">${esc(j.summary || '')}</p>
      <div class="chips">${(j.matchedSkills || []).map(s => `<span class="chip gold">${esc(s)}</span>`).join('')}</div>
      <div class="row" style="margin-top:10px">
        ${inTrack ? `<button class="btn sm" data-tab-go="suivi">Voir dans le suivi</button>`
          : `<button class="btn sm primary" data-act="apply" data-id="${esc(j.id)}">Postuler</button>`}
        <a class="btn sm ghost" href="${esc(j.url)}" target="_blank" rel="noopener">Voir l'offre ↗</a>
        ${isIgnored ? `<button class="btn sm ghost" data-act="unignore" data-id="${esc(j.id)}">Rétablir</button>`
          : inTrack ? '' : `<button class="btn sm ghost" data-act="ignore" data-id="${esc(j.id)}">Ignorer</button>`}
        ${inTrack || isIgnored ? '' : `<label class="pick"><input type="checkbox" data-pick="${esc(j.id)}"${picked.has(j.id) ? ' checked' : ''}> sélectionner</label>`}
      </div>
    </div></article>`;
}
async function applyTo(ids) {
  if (!ids.length) return;
  sync('busy');
  try {
    await dispatch(ids);
    for (const id of ids) track(id, { stage: 'preparation' });
    picked.clear();
    saveTracking();
    toast(ids.length > 1 ? `Le robot prépare ${ids.length} candidatures (≈ 1 min)` : 'Le robot prépare ta candidature (≈ 1 min)');
    render();
  } catch (e) { sync('err'); toast(`Impossible de lancer le robot : ${e.message}`, true); }
}

// Photo : recadrée en carré 600 px côté navigateur, puis enregistrée dans profile/photo.jpg.
async function uploadPhoto(file) {
  sync('busy');
  try {
    const img = await createImageBitmap(file);
    const side = Math.min(img.width, img.height), c = Object.assign(document.createElement('canvas'), { width: 600, height: 600 });
    c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 600, 600);
    const b64 = c.toDataURL('image/jpeg', 0.88).split(',')[1];
    let sha;
    try { sha = (await gh(R(`/contents/${P('profile/photo.jpg')}?ref=${S.branch}`))).sha; } catch {}
    await gh(R(`/contents/${P('profile/photo.jpg')}`), { method: 'PUT', body: { message: 'JobPilot : nouvelle photo', content: b64, branch: S.branch, ...(sha ? { sha } : {}) } });
    S.photoV = Date.now(); sync('ok');
    toast('Photo enregistrée ✔ Elle apparaîtra sur tes prochains CV et sur le site dans 1 à 2 minutes.');
    watchRobot(); render();
  } catch (err) { sync('err'); toast(`Photo non enregistrée : ${err.message}`, true); }
}

// ------------------------------------------------------------------ Entreprises (candidatures spontanées)
function viewCompanies() {
  const q = filters.q.toLowerCase();
  const list = S.companies.filter(c => !S.tracking.apps[c.id] && (!q || `${c.name} ${c.city} ${c.sector}`.toLowerCase().includes(q)));
  const lbb = S.run.sources?.laBonneBoite;
  // Le « score » de La Bonne Boîte n'a pas d'échelle fixe : on l'exprime par rapport à la meilleure entreprise trouvée.
  const max = Math.max(1, ...S.companies.map(c => +c.score || 0));
  const rel = c => Math.round(100 * (+c.score || 0) / max);
  return `<div class="head"><div><h2>Entreprises qui recrutent</h2><div class="muted small">Selon La Bonne Boîte (France Travail), ces entreprises de ta zone vont probablement embaucher dans tes métiers, même sans offre publiée : idéal pour une candidature spontanée.</div></div></div>
  <div class="toolbar"><input type="search" id="q" placeholder="Filtrer : entreprise, ville, secteur…" value="${esc(filters.q)}"></div>
  ${list.length ? list.map(c => `<article class="card job">
    <div class="score" style="--s:${rel(c)}" title="Potentiel d'embauche, relatif à la meilleure entreprise trouvée">${c.score ? rel(c) : '—'}</div>
    <div class="body">
      <h3>${esc(c.name)}</h3>
      <div class="meta">${esc([c.postcode, c.city].filter(Boolean).join(' '))}${c.distance ? ` · ${Math.round(c.distance)} km` : ''}${c.headcount ? ` · ${esc(c.headcount)}` : ''}</div>
      ${c.sector ? `<div class="chips"><span class="chip">${esc(c.sector)}</span></div>` : ''}
      <div class="row" style="margin-top:10px">
        <button class="btn sm primary" data-act="apply" data-id="${esc(c.id)}">Candidature spontanée</button>
        <a class="btn sm ghost" href="https://www.google.com/search?q=${encodeURIComponent(`${c.name} ${c.city || ''} recrutement`)}" target="_blank" rel="noopener">Rechercher l'entreprise ↗</a>
        <button class="btn sm ghost" data-act="ignore" data-id="${esc(c.id)}">Ignorer</button>
      </div>
    </div></article>`).join('')
    : `<div class="card muted">${S.companies.length ? 'Toutes les entreprises ont été traitées.' : `Aucune entreprise pour le moment${lbb ? ` (${esc(lbb)})` : ''}. Il faut tes clés France Travail (onglet « Clés & envoi ») avec l'API « La Bonne Boite » ajoutée à ton application.`}</div>`}`;
}

// ------------------------------------------------------------------ Suivi
function viewTracking() {
  const apps = activeApps().map(([id, a]) => ({ id, a, ...effective(id, a) }))
    .sort((x, y) => (y.due - x.due) || new Date(y.a.updatedAt || y.a.at) - new Date(x.a.updatedAt || x.a.at));
  return `<div class="head"><div><h2>Suivi des candidatures</h2><div class="muted small">Tout est enregistré automatiquement. Une relance est suggérée 7 jours après l'envoi.</div></div>
    <button class="btn sm" data-act="manual-toggle">+ Ajouter une candidature faite ailleurs</button></div>
  <form id="manualForm" class="card" hidden>
    <h3>Candidature faite hors JobPilot</h3>
    <div class="grid3" style="margin-top:10px">
      <label class="field"><span>Entreprise</span><input type="text" name="company" required></label>
      <label class="field"><span>Poste</span><input type="text" name="title" required></label>
      <label class="field"><span>Date d'envoi</span><input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label>
    </div>
    <label class="field" style="margin-top:10px"><span>Lien de l'offre (facultatif)</span><input type="url" name="url" placeholder="https://"></label>
    <div class="row" style="margin-top:10px"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
  <div class="board" style="margin-top:12px">${STAGES.map(st => {
    const items = apps.filter(x => x.column === st.id);
    return `<section class="col"><h3><span>${st.label}</span><span>${items.length}</span></h3>${items.length ? items.map(appCard).join('') : `<div class="empty">—</div>`}</section>`;
  }).join('')}</div>`;
}
function appCard(x) {
  const { id, a, stage, sentAt, due, folder } = x;
  const docs = folder ? `<div class="row" style="margin-top:8px">
      <button class="btn sm primary" data-preview="data/applications/${esc(folder)}/cv.html">Aperçu du CV</button>
      <button class="btn sm ghost" data-preview="data/applications/${esc(folder)}/lettre.html">Aperçu de la lettre</button>
      <button class="btn sm" data-dl="data/applications/${esc(folder)}/cv.pdf" data-name="CV - ${esc(a.company)}.pdf">CV PDF</button>
      <button class="btn sm" data-dl="data/applications/${esc(folder)}/lettre.pdf" data-name="Lettre - ${esc(a.company)}.pdf">Lettre PDF</button>
      <button class="btn sm ghost" data-dl="data/applications/${esc(folder)}/lettre.txt" data-name="Lettre - ${esc(a.company)}.txt">Texte</button></div>`
    : stage === 'preparation' ? `<div class="small muted" style="margin-top:6px">⏳ Le robot prépare le CV et la lettre…</div>` : '';
  const email = x.job?.contactEmail;
  const quick = stage === 'a_envoyer' && email && folder ? `<button class="btn sm primary" data-act="send-mail" data-id="${esc(id)}">✉️ Envoyer par e-mail</button><button class="btn sm" data-act="mark-sent" data-id="${esc(id)}">J'ai envoyé</button>`
    : stage === 'a_envoyer' && !a.manual ? `<button class="btn sm primary" data-act="mark-sent" data-id="${esc(id)}">J'ai envoyé</button>`
    : due ? `<button class="btn sm primary" data-act="mark-relance" data-id="${esc(id)}">C'est relancé</button>` : '';
  return `<article class="card app">
    ${due ? `<div class="due">⏰ À relancer</div>` : ''}
    <div class="t">${esc(a.company || '—')}${a.auto ? ' <span class="chip">auto</span>' : ''}</div>
    <div class="small">${esc(a.title || '')}</div>
    <div class="small muted">${sentAt ? `Envoyée le ${fmtDay(sentAt)}` : `Ajoutée le ${fmtDay(a.at)}`}${a.relanceAt ? ` · relancée le ${fmtDay(a.relanceAt)}` : ''}</div>
    ${docs}
    <div class="row" style="margin-top:8px">${quick}${a.url ? `<a class="btn sm ghost" href="${esc(a.url)}" target="_blank" rel="noopener">Offre ↗</a>` : ''}</div>
    <select data-stage="${esc(id)}" aria-label="Étape">${STAGE_OPTIONS.map(([v, l]) => `<option value="${v}"${v === stage ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <textarea data-note="${esc(id)}" placeholder="Notes : contact, date d'entretien, ressenti…">${esc(a.notes || '')}</textarea>
  </article>`;
}

// ------------------------------------------------------------------ éditeur générique (profil / recherche)
const TPL = {
  title: () => ({ text: '', tags: [] }),
  summary: () => ({ text: '', tags: [] }),
  motivation: () => ({ text: '', tags: [] }),
  experience: () => ({ role: '', company: '', location: '', start: '', end: '', bullets: [{ text: '', tags: [] }] }),
  bullet: () => ({ text: '', tags: [] }),
  skill: () => ({ name: '', level: 3, aliases: [] }),
  education: () => ({ degree: '', school: '', start: '', end: '', tags: [] }),
  language: () => ({ name: '', level: '' }),
};
const getPath = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => x[k], o); t[last] = v; }
const listVal = v => Array.isArray(v) ? v.join(', ') : '';
const linesVal = v => Array.isArray(v) ? v.join('\n') : '';
function parseVal(kind, raw, el) {
  if (kind === 'list') return raw.split(',').map(s => s.trim()).filter(Boolean);
  if (kind === 'lines') return raw.split('\n').map(s => s.trim()).filter(Boolean);
  if (kind === 'num') return raw === '' ? 0 : Number(raw);
  if (kind === 'bool') return el.checked;
  return raw;
}
const inp = (path, label, { kind = 'text', type = 'text', hint = '', placeholder = '', area = false } = {}) => {
  const v = getPath(draft, path);
  const val = kind === 'list' ? listVal(v) : kind === 'lines' ? linesVal(v) : (v ?? '');
  const control = area || kind === 'lines'
    ? `<textarea data-path="${path}" data-kind="${kind}" placeholder="${esc(placeholder)}" rows="${kind === 'lines' ? 4 : 3}">${esc(val)}</textarea>`
    : `<input type="${type}" data-path="${path}" data-kind="${kind}" value="${esc(val)}" placeholder="${esc(placeholder)}">`;
  return `<label class="field"><span>${label}</span>${control}${hint ? `<div class="hint">${hint}</div>` : ''}</label>`;
};
const toggle = (path, label) => `<label class="switch"><input type="checkbox" data-path="${path}" data-kind="bool"${getPath(draft, path) ? ' checked' : ''}> ${label}</label>`;
const del = path => `<button type="button" class="btn sm ghost danger x" data-del="${path}" aria-label="Supprimer">✕</button>`;
const add = (path, tpl, label) => `<button type="button" class="btn sm" data-add="${path}" data-tpl="${tpl}">+ ${label}</button>`;
function textItems(path, tpl, label, addLabel, hint) {
  const arr = getPath(draft, path) || [];
  return `<div class="section-title"><h3>${label}</h3>${add(path, tpl, addLabel)}</div>
    ${hint ? `<p class="hint" style="margin-top:-6px">${hint}</p>` : ''}
    ${arr.map((_, i) => `<div class="item">${del(`${path}.${i}`)}
      ${inp(`${path}.${i}.text`, 'Texte', { area: true })}
      <div style="margin-top:8px">${inp(`${path}.${i}.tags`, 'Mots-clés (séparés par des virgules)', { kind: 'list', hint: "Aident le moteur à choisir ce texte quand l'offre parle de ces sujets." })}</div>
    </div>`).join('')}`;
}

// ------------------------------------------------------------------ Mon profil
function viewProfile() {
  if (!S.profile) return `<div class="card">Profil introuvable (${esc(S.errors.profile || 'profile/profile.json')}).</div>`;
  if (!draft || dirty !== 'profile') draft = clone(S.profile);
  draft.identity ||= {};
  const id = 'identity';
  return `<div class="head"><div><h2>Mon profil</h2><div class="muted small">Ta source de vérité : le CV adapté ne contiendra <b>que</b> ce qui est écrit ici. Plus tu proposes de variantes vraies, mieux il s'adapte.</div></div></div>
  <div class="card">
    <div class="row" style="gap:14px;margin-bottom:6px">
      <img src="../photo.jpg?v=${S.photoV || 0}" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover;object-position:50% 30%;background:var(--soft)" onerror="this.style.visibility='hidden'">
      <div><h3>Identité & contact</h3><label class="btn sm" style="margin-top:6px">Changer la photo<input type="file" accept="image/*" id="photoInput" hidden></label>
      <div class="hint">Utilisée sur ton CV et dans ton film 3D.</div></div>
    </div>
    <div class="grid2" style="margin-top:10px">
      ${inp(`${id}.firstName`, 'Prénom')}${inp(`${id}.lastName`, 'Nom')}
      ${inp(`${id}.email`, 'E-mail', { type: 'email' })}${inp(`${id}.city`, 'Ville')}
      ${inp(`${id}.availability`, 'Disponibilité', { placeholder: 'Disponible immédiatement' })}${inp(`${id}.linkedin`, 'LinkedIn', { type: 'url' })}
      ${inp(`${id}.github`, 'GitHub', { type: 'url' })}${inp(`${id}.website`, 'Site web', { type: 'url' })}
    </div>
    <p class="hint">Le téléphone se règle dans « Clés & envoi » : il n'apparaît que dans les PDF envoyés, jamais en ligne.</p>
  </div>
  <div class="card">${textItems('titles', 'title', 'Titres possibles', 'Titre', 'Le moteur choisit, pour chaque offre, le titre vrai le plus proche.')}</div>
  <div class="card">${textItems('summaries', 'summary', 'Résumés (accroches)', 'Résumé', 'Écris plusieurs accroches vraies, chacune orientée vers un type de poste.')}</div>
  <div class="card">
    <div class="section-title" style="margin-top:0"><h3>Expériences</h3>${add('experiences', 'experience', 'Expérience')}</div>
    <p class="hint" style="margin-top:-6px">Une expérience sans date n'apparaît dans le CV que si elle sert l'offre.</p>
    ${(draft.experiences || []).map((e, i) => `<div class="item">
      <div class="row" style="position:absolute;top:8px;right:8px">
        <button type="button" class="btn sm ghost" data-up="experiences.${i}" ${i ? '' : 'disabled'} aria-label="Monter">↑</button>
        <button type="button" class="btn sm ghost danger" data-del="experiences.${i}" aria-label="Supprimer">✕</button></div>
      <div class="grid2" style="margin-top:22px">
        ${inp(`experiences.${i}.role`, 'Poste')}${inp(`experiences.${i}.company`, 'Entreprise')}
        ${inp(`experiences.${i}.location`, 'Lieu')}
        <div class="grid2">${inp(`experiences.${i}.start`, 'Début', { placeholder: '2024 ou 2024-03' })}${inp(`experiences.${i}.end`, 'Fin', { placeholder: 'vide = aujourd’hui' })}</div>
      </div>
      <div class="section-title"><h3 class="small">Réalisations</h3>${add(`experiences.${i}.bullets`, 'bullet', 'Réalisation')}</div>
      <div class="bullets">${(e.bullets || []).map((_, b) => `<div class="item">${del(`experiences.${i}.bullets.${b}`)}
        ${inp(`experiences.${i}.bullets.${b}.text`, 'Réalisation', { area: true })}
        <div style="margin-top:8px">${inp(`experiences.${i}.bullets.${b}.tags`, 'Mots-clés', { kind: 'list' })}</div></div>`).join('')}</div>
    </div>`).join('')}
  </div>
  <div class="card">
    <div class="section-title" style="margin-top:0"><h3>Compétences</h3>${add('skills', 'skill', 'Compétence')}</div>
    <p class="hint" style="margin-top:-6px">Les synonymes permettent de reconnaître la compétence dans les offres (ex. « négociation, negotiation »).</p>
    ${(draft.skills || []).map((s, i) => `<div class="item">${del(`skills.${i}`)}
      <div class="grid2">${inp(`skills.${i}.name`, 'Compétence')}
      <label class="field"><span>Niveau</span><div class="level">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-level="skills.${i}.level" data-v="${n}" class="${n <= s.level ? 'on' : ''}" aria-label="Niveau ${n}"></button>`).join('')}</div></label></div>
      <div style="margin-top:8px">${inp(`skills.${i}.aliases`, 'Synonymes', { kind: 'list' })}</div></div>`).join('')}
  </div>
  <div class="card">
    <div class="section-title" style="margin-top:0"><h3>Formation</h3>${add('education', 'education', 'Formation')}</div>
    ${(draft.education || []).map((_, i) => `<div class="item">${del(`education.${i}`)}<div class="grid2" style="margin-top:8px">
      ${inp(`education.${i}.degree`, 'Diplôme')}${inp(`education.${i}.school`, 'Établissement')}${inp(`education.${i}.start`, 'Début')}${inp(`education.${i}.end`, 'Fin')}</div></div>`).join('')}
  </div>
  <div class="card">
    <div class="section-title" style="margin-top:0"><h3>Langues</h3>${add('languages', 'language', 'Langue')}</div>
    ${(draft.languages || []).map((_, i) => `<div class="item">${del(`languages.${i}`)}<div class="grid2" style="margin-top:8px">${inp(`languages.${i}.name`, 'Langue')}${inp(`languages.${i}.level`, 'Niveau', { placeholder: 'Courant (C1)' })}</div></div>`).join('') || '<p class="muted small">Aucune langue renseignée.</p>'}
  </div>
  <div class="card">${inp('interests', "Centres d'intérêt (un par ligne)", { kind: 'lines' })}</div>
  <div class="card">${textItems('motivations', 'motivation', 'Motivations', 'Motivation', 'Utilisées dans la lettre : « Ce qui me motive avant tout : … ».')}</div>`;
}

// ------------------------------------------------------------------ Recherche
function viewPrefs() {
  if (!S.prefs) return `<div class="card">Préférences introuvables (${esc(S.errors.prefs || 'profile/preferences.json')}).</div>`;
  if (!draft || dirty !== 'prefs') draft = clone(S.prefs);
  draft.sources ||= {}; draft.franceTravail ||= {}; draft.adzuna ||= {}; draft.autoApply ||= { enabled: false, minScore: 80, maxPerDay: 5 };
  return `<div class="head"><div><h2>Ce que je recherche</h2><div class="muted small">Le robot utilise ces réglages à chaque passage.</div></div></div>
  <div class="card stack">
    ${inp('queries', 'Recherches envoyées aux sites (une par ligne)', { kind: 'lines', hint: 'Ex. « directeur commercial », « business developer ».' })}
    ${inp('locations', 'Lieux acceptés (un par ligne)', { kind: 'lines', hint: 'Villes, départements (74), pays, ou « remote ».' })}
    ${toggle('acceptRemote', 'Accepter les offres 100 % télétravail')}
  </div>
  <div class="card stack">
    <div class="grid2">
      ${inp('mustHave', "Mots obligatoires (au moins un dans l'offre)", { kind: 'lines' })}
      ${inp('exclude', 'Mots interdits dans le titre', { kind: 'lines', hint: 'Ex. stage, alternance, junior.' })}
    </div>
    <div class="grid3">
      ${inp('minScore', 'Note minimale (0–100)', { kind: 'num', type: 'number' })}
      ${inp('maxAgeDays', 'Âge maximum des offres (jours)', { kind: 'num', type: 'number' })}
      ${inp('maxJobs', "Nombre maximum d'offres gardées", { kind: 'num', type: 'number' })}
    </div>
  </div>
  <div class="card stack">
    <div><h3>Candidatures automatiques</h3><p class="muted small" style="margin:2px 0 0">Après chaque recherche, le robot prépare lui-même les candidatures des meilleures offres : CV adapté et lettre. Quand l'offre donne une adresse e-mail et que l'envoi automatique est activé (onglet « Clés & envoi »), il les envoie aussi. Les autres t'attendent dans « Suivi », prêtes à être déposées sur le site de l'offre.</p></div>
    ${toggle('autoApply.enabled', 'Activer les candidatures automatiques')}
    <div class="grid3">
      ${inp('autoApply.minScore', 'Note minimale de l\'offre', { kind: 'num', type: 'number' })}
      ${inp('autoApply.maxPerDay', 'Maximum par jour', { kind: 'num', type: 'number' })}
      <div class="stack" style="align-self:end">${toggle('autoApply.onlyWithEmail', 'Seulement les offres avec e-mail')}${toggle('autoApply.spontaneous', 'Aussi les candidatures spontanées (si e-mail connu)')}</div>
    </div>
  </div>
  <div class="card stack">
    <h3>Sources</h3>
    <div class="row">${toggle('sources.franceTravail', 'France Travail')}${toggle('sources.adzuna', 'Adzuna')}${toggle('sources.arbeitnow', 'Arbeitnow')}${toggle('sources.remotive', 'Remotive')}</div>
    <div class="grid2">
      ${inp('franceTravail.departements', 'France Travail : départements', { kind: 'list', hint: 'Ex. 74, 73, 01, 69' })}
      <p class="hint" style="align-self:end">Adzuna et La Bonne Boîte cherchent en Haute-Savoie et autour de Lyon ; le filtre « Lieux acceptés » ci-dessus s'applique ensuite à toutes les sources.</p>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ Clés & envoi
const KEYGROUPS = [
  { title: 'France Travail', why: "Entreprises qui recrutent (La Bonne Boîte) et, si l'accès t'est accordé, offres d'emploi France Travail.",
    steps: ['Sur <a href="https://francetravail.io" target="_blank" rel="noopener">francetravail.io</a>, ouvre ton application JobPilot.', "Vérifie que l'API « La Bonne Boite » y est ajoutée. L'API « Offres d'emploi » demande une autorisation spéciale : tu peux la demander via « Nous contacter ».", "Copie l'identifiant client et la clé secrète ci-dessous."],
    keys: [['FT_CLIENT_ID', 'Identifiant client'], ['FT_CLIENT_SECRET', 'Clé secrète']] },
  { title: 'Adzuna', why: 'Agrégateur de milliers de sites d’emploi français.',
    steps: ['Crée un compte sur <a href="https://developer.adzuna.com" target="_blank" rel="noopener">developer.adzuna.com</a>.', 'Copie « Application ID » et « Application Key ».'],
    keys: [['ADZUNA_APP_ID', 'Application ID'], ['ADZUNA_APP_KEY', 'Application Key']] },
  { title: 'Lettre rédigée par l’IA (Gemini)', why: "Lettre écrite dans la langue de l'offre, rejetée automatiquement si elle invente un fait.",
    steps: ['Va sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.', 'Create API key, puis copie-la.'],
    keys: [['GEMINI_API_KEY', 'Clé API Gemini']] },
  { title: 'Téléphone sur les PDF', why: 'Ajouté uniquement dans les PDF envoyés aux recruteurs, jamais sur le site public.',
    keys: [['CV_PHONE', 'Numéro de téléphone']] },
];
function viewKeys() {
  const has = n => S.secrets.includes(n);
  const secretRow = ([name, label]) => `<form class="secret" data-secret="${name}">
      <label class="field"><span>${label} <span class="state ${has(name) ? 'ok' : 'no'}">${has(name) ? 'enregistré' : 'vide'}</span></span>
      <input type="${name === 'CV_PHONE' || name === 'SMTP_HOST' || name === 'SMTP_PORT' || name === 'SMTP_USER' ? 'text' : 'password'}" name="value" autocomplete="off" placeholder="${has(name) ? 'Laisser vide pour ne pas changer' : ''}"></label>
      <button class="btn" type="submit">Enregistrer</button></form>`;
  const autoSend = S.vars.AUTO_SEND === 'true';
  return `<div class="head"><div><h2>Clés & envoi</h2><div class="muted small">Les clés sont chiffrées dans ton navigateur puis stockées comme secrets GitHub : personne ne peut les relire, pas même cette page.</div></div></div>
  ${KEYGROUPS.map(g => `<div class="card stack">
    <div><h3>${g.title}</h3><p class="muted small" style="margin:2px 0 0">${g.why}</p>
    ${g.steps ? `<ol class="steps small">${g.steps.map(s => `<li>${s}</li>`).join('')}</ol>` : ''}</div>
    ${g.keys.map(secretRow).join('')}</div>`).join('')}
  <div class="card stack">
    <div><h3>Envoi automatique par e-mail</h3>
    <p class="muted small" style="margin:2px 0 0">Quand une offre donne une adresse de candidature, le robot peut envoyer lui-même le CV et la lettre depuis ta boîte. Outlook.com n'autorise plus l'envoi par un programme : utilise une adresse Gmail dédiée à l'envoi. Active sa validation en deux étapes, puis crée un <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">mot de passe d'application</a>. Les recruteurs verront ton nom ; leurs réponses et une copie de chaque envoi arriveront sur ${esc(S.profile?.identity?.email || 'ton adresse')}.</p></div>
    <div class="row"><button class="btn sm ghost" data-act="smtp-gmail">Préremplir pour Gmail</button></div>
    ${[['SMTP_HOST', 'Serveur SMTP'], ['SMTP_PORT', 'Port'], ['SMTP_USER', 'Adresse e-mail d’envoi'], ['SMTP_PASS', "Mot de passe d'application"]].map(secretRow).join('')}
    <label class="switch"><input type="checkbox" id="autosend"${autoSend ? ' checked' : ''}> Envoyer automatiquement les candidatures quand c'est possible</label>
    <p class="hint">Désactivé : le robot prépare tout et tu envoies toi-même depuis l'onglet Suivi.</p>
  </div>`;
}
async function saveSecret(name, value) {
  sync('busy');
  try {
    const { key, key_id } = await gh(R('/actions/secrets/public-key'));
    await gh(R(`/actions/secrets/${name}`), { method: 'PUT', body: { encrypted_value: seal(value, key), key_id } });
    if (!S.secrets.includes(name)) S.secrets.push(name);
    sync('ok'); toast(`${name} enregistré ✔`);
    render();
  } catch (e) { sync('err'); toast(`Échec : ${e.message}`, true); }
}
async function setVar(name, value) {
  sync('busy');
  try {
    if (name in S.vars) await gh(R(`/actions/variables/${name}`), { method: 'PATCH', body: { name, value } });
    else await gh(R('/actions/variables'), { method: 'POST', body: { name, value } });
    S.vars[name] = value; sync('ok'); toast('Réglage enregistré ✔');
  } catch (e) { sync('err'); toast(`Échec : ${e.message}`, true); render(); }
}

// ------------------------------------------------------------------ Robot
function viewRobot() {
  const label = r => r.event === 'schedule' ? 'Passage du matin' : r.event === 'push' ? 'Après une modification' : r.event === 'issues' ? 'Candidature (ticket)' : 'Lancement manuel';
  const state = r => r.status !== 'completed' ? 'en cours…' : r.conclusion === 'success' ? 'terminé' : r.conclusion === 'cancelled' ? 'annulé' : 'erreur';
  return `<div class="head"><div><h2>Robot</h2><div class="muted small">Il cherche les offres chaque matin vers 6 h, et à chaque modification de ton profil ou de ta recherche.</div></div>
    <button class="btn primary" data-act="search-now">Lancer une recherche maintenant</button></div>
  <div class="card"><h3>Derniers passages</h3><div class="runs" style="margin-top:8px">
    ${S.runs.length ? S.runs.map(r => `<div class="run"><span class="dot ${r.status === 'completed' ? r.conclusion : r.status}"></span>
      <span>${label(r)}</span><span class="muted small">${fmtWhen(r.created_at)}</span><span class="spacer"></span>
      <span class="small">${state(r)}</span><a class="small" href="${esc(r.html_url)}" target="_blank" rel="noopener">détails</a></div>`).join('')
      : `<p class="muted small">Aucun passage pour l'instant${S.errors.runs ? ` (${esc(S.errors.runs)})` : ''}.</p>`}
  </div></div>
  <div class="card"><h3>Dernière recherche</h3>
    ${S.run.sources ? `<ul class="small">${Object.entries(S.run.sources).map(([k, v]) => `<li><b>${esc(k)}</b> : ${esc(v)}</li>`).join('')}</ul>
    <p class="small muted">${S.run.fetched ?? '?'} offres lues, ${S.run.kept ?? '?'} retenues · ${fmtWhen(S.run.finishedAt)}</p>` : '<p class="muted small">Pas encore de données.</p>'}
  </div>`;
}

// ------------------------------------------------------------------ Connexion
function viewAccount() {
  return `<div class="head"><div><h2>Connexion</h2><div class="muted small">Le jeton est conservé uniquement dans ce navigateur.</div></div></div>
  <div class="card stack">
    <p>Connecté au dépôt <b>${esc(cfg.owner)}/${esc(cfg.repo)}</b> (branche <code>${esc(S.branch)}</code>, dossier <code>${esc(cfg.dir)}</code>).</p>
    ${Object.keys(S.errors).length ? `<p class="small" style="color:var(--bad)">Éléments non chargés : ${Object.entries(S.errors).map(([k, v]) => `${esc(k)} (${esc(v)})`).join(', ')}. Vérifie les permissions du jeton.</p>` : '<p class="small muted">Tout est chargé correctement.</p>'}
    <div class="row"><button class="btn" data-act="reload">Recharger les données</button><a class="btn ghost" href="${esc(tokenUrl())}" target="_blank" rel="noopener">Créer un nouveau jeton</a><button class="btn danger" data-act="logout">Se déconnecter de ce navigateur</button></div>
  </div>`;
}

// ------------------------------------------------------------------ événements
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t && t !== tab) go(t); });

view.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'q') { filters.q = el.value; const pos = el.selectionStart; render(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); return; }
  if (el.dataset.path) { setPath(draft, el.dataset.path, parseVal(el.dataset.kind, el.value, el)); dirty = tab === 'profil' ? 'profile' : 'prefs'; $('#savebar').hidden = false; }
  if (el.dataset.note) { track(el.dataset.note, { notes: el.value }); saveTracking(1500); }
});
view.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'photoInput' && el.files[0]) return uploadPhoto(el.files[0]);
  if (el.id === 'fstatus') { filters.status = el.value; render(); }
  if (el.id === 'fmin') { filters.min = +el.value; render(); }
  if (el.dataset.pick) { el.checked ? picked.add(el.dataset.pick) : picked.delete(el.dataset.pick); render(); }
  if (el.dataset.stage) {
    const patch = { stage: el.value };
    if (el.value === 'envoyee' && !S.tracking.apps[el.dataset.stage]?.sentAt) patch.sentAt = new Date().toISOString();
    if (el.value === 'relancee') patch.relanceAt = new Date().toISOString();
    track(el.dataset.stage, patch); saveTracking(); render();
  }
  if (el.id === 'autosend') setVar('AUTO_SEND', el.checked ? 'true' : 'false');
});
view.addEventListener('click', async e => {
  const t = e.target.closest('button, a');
  if (!t) return;
  const d = t.dataset;
  if (d.tabGo) return go(d.tabGo);
  if (d.dl) return downloadFile(d.dl, d.name);
  if (d.preview) return preview(d.preview);
  if (d.add) { const arr = getPath(draft, d.add) || (setPath(draft, d.add, []), getPath(draft, d.add)); arr.push(TPL[d.tpl]()); markDirty(); return render(); }
  if (d.del) { const ks = d.del.split('.'); const i = +ks.pop(); getPath(draft, ks.join('.')).splice(i, 1); markDirty(); return render(); }
  if (d.up) { const ks = d.up.split('.'); const i = +ks.pop(); const arr = getPath(draft, ks.join('.')); [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; markDirty(); return render(); }
  if (d.level) { setPath(draft, d.level, +d.v); markDirty(); return render(); }
  switch (d.act) {
    case 'apply': return applyTo([d.id]);
    case 'apply-picked': return applyTo([...picked]);
    case 'ignore': track(d.id, { stage: 'ignoree' }); saveTracking(); return render();
    case 'unignore': delete S.tracking.apps[d.id]; saveTracking(); return render();
    case 'mark-sent': track(d.id, { stage: 'envoyee', sentAt: new Date().toISOString() }); saveTracking(); toast('Bravo ! Relance suggérée dans 7 jours.'); return render();
    case 'send-mail': {
      const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(n => !S.secrets.includes(n));
      if (missing.length) { toast(`Configure d'abord l'envoi d'e-mails dans « Clés & envoi » (${missing.join(', ')}).`, true); return; }
      const to = jobById(d.id)?.contactEmail;
      if (!confirm(`Envoyer le CV et la lettre à ${to} ?`)) return;
      sync('busy');
      try { await dispatch([d.id], true); track(d.id, { stage: 'preparation', mailAt: new Date().toISOString() }); saveTracking(); toast('Envoi en cours (≈ 1 min)…'); render(); }
      catch (err) { sync('err'); toast(`Impossible de lancer l'envoi : ${err.message}`, true); }
      return;
    }
    case 'mark-relance': track(d.id, { stage: 'relancee', relanceAt: new Date().toISOString() }); saveTracking(); return render();
    case 'manual-toggle': { const f = $('#manualForm'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); return; }
    case 'search-now':
      sync('busy');
      try { await dispatch([]); toast('Recherche lancée — résultats dans 1 à 2 minutes.'); } catch (err) { sync('err'); toast(`Impossible de lancer le robot : ${err.message}`, true); }
      return;
    case 'smtp-gmail': { const f = n => view.querySelector(`[data-secret="${n}"] input`); f('SMTP_HOST').value = 'smtp.gmail.com'; f('SMTP_PORT').value = '465'; f('SMTP_USER').focus(); toast('Clique sur « Enregistrer » à côté de chaque champ.'); return; }
    case 'reload': S.loaded = false; view.innerHTML = '<p class="muted center">Chargement…</p>'; if (await loadAll()) render(); return;
    case 'logout': if (confirm('Oublier le jeton sur ce navigateur ?')) { delete cfg.token; saveCfg(); location.reload(); } return;
  }
});
view.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'loginForm') {
    const fd = new FormData(f);
    cfg = { ...cfg, owner: fd.get('owner').trim(), repo: fd.get('repo').trim(), token: fd.get('token').trim(), dir: (fd.get('dir') || 'jobpilot').trim() };
    saveCfg();
    view.innerHTML = '<p class="muted center">Connexion…</p>';
    try { if (await loadAll()) { toast('Connecté ✔'); render(); } } catch (err) { renderLogin(err.message); }
    return;
  }
  if (f.id === 'manualForm') {
    const fd = new FormData(f);
    const id = `manuel-${Date.now()}`;
    const date = fd.get('date') ? new Date(fd.get('date')).toISOString() : new Date().toISOString();
    S.tracking.apps[id] = { manual: true, company: fd.get('company'), title: fd.get('title'), url: fd.get('url'), stage: 'envoyee', at: date, sentAt: date, updatedAt: new Date().toISOString() };
    saveTracking(); toast('Candidature ajoutée au suivi.'); render();
    return;
  }
  if (f.dataset.secret) {
    const v = f.elements.value.value.trim();
    if (!v) return toast('Champ vide : rien à enregistrer.');
    return saveSecret(f.dataset.secret, v);
  }
});
function markDirty() { dirty = tab === 'profil' ? 'profile' : 'prefs'; $('#savebar').hidden = false; }

$('#discard').addEventListener('click', () => { dirty = null; draft = null; render(); });
$('#save').addEventListener('click', async () => {
  const btn = $('#save');
  btn.disabled = true; sync('busy');
  try {
    if (dirty === 'profile') {
      await writeJson('profile/profile.json', draft, 'JobPilot : mise à jour du profil');
      S.profile = clone(draft);
    } else if (dirty === 'prefs') {
      await writeJson('profile/preferences.json', draft, 'JobPilot : mise à jour de la recherche');
      S.prefs = clone(draft);
    }
    dirty = null; draft = null; sync('ok');
    toast('Enregistré ✔ Le robot relance la recherche avec ces réglages.');
    watchRobot(); render();
  } catch (e) {
    sync('err');
    toast(e.status === 409 ? 'Le fichier a été modifié ailleurs : recharge la page puis recommence.' : `Échec de l'enregistrement : ${e.message}`, true);
  } finally { btn.disabled = false; }
});
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ------------------------------------------------------------------ démarrage
(async () => {
  if (!cfg.token) return renderLogin();
  try { if (await loadAll()) render(); } catch (e) { sync('err'); renderLogin(e.message); }
})();
