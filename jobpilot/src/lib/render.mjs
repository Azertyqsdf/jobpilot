// Rendu HTML du CV adapté (format A4, imprimable en PDF) et de la lettre.
import { escapeHtml as h } from './text.mjs';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export function fmtDate(d) {
  if (!d) return "aujourd'hui";
  const [y, m] = String(d).split('-');
  return m ? `${MONTHS[+m - 1]} ${y}` : y;
}

// Pictogramme « film 3D » : une claquette de cinéma posée sur un cube.
export const FILM_ICON = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
<rect x="1" y="1" width="46" height="46" rx="12" fill="#0b0f1a"/>
<path d="M12 20h24v14a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2z" fill="#f5c542"/>
<path d="M11.4 14.6l22.8-5 1.2 5.4-22.8 5z" fill="#fff"/>
<path d="M15 13.8l3.5 4.4M21.5 12.4l3.5 4.4M28 11l3.5 4.4" stroke="#0b0f1a" stroke-width="2.2"/>
<path d="M21 24.5v8l7-4z" fill="#0b0f1a"/>
</svg>`;

export function renderCv(profile, cv, { filmUrl, job, photo } = {}) {
  const id = profile.identity;
  const contact = [id.city, id.email, id.phone].filter(Boolean).map(h);
  if (id.availability) contact.push(`<strong>${h(id.availability)}</strong>`);
  const links = [['LinkedIn', id.linkedin], ['GitHub', id.github], ['Site', id.website]].filter(([, u]) => u)
    .map(([n, u]) => `<a href="${h(u)}">${n}</a>`);
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CV — ${h(id.firstName)} ${h(id.lastName)}${job ? ` — ${h(job.company)}` : ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
:root { --ink:#141821; --muted:#5b6475; --accent:#2f5bea; --line:#e3e7ef; --hl:#fff4cc; }
html { background:#e9ecf2; }
body { margin:0; font: 9.8pt/1.4 "Inter", "Segoe UI", system-ui, -apple-system, sans-serif; color:var(--ink); }
.page { width:210mm; min-height:297mm; margin:24px auto; background:#fff; padding:14mm 15mm 12mm; box-shadow:0 10px 40px #0002; display:grid; grid-template-columns: 1fr 58mm; gap:0 9mm; }
@media print { html, body { background:#fff; } .page{ margin:0; box-shadow:none; min-height:0; padding-bottom:6mm; } }
@media screen and (max-width: 820px) { .page{ width:auto; min-height:0; margin:0; grid-template-columns:1fr; padding:20px 16px; } }
.who { display:flex; align-items:center; gap:14px; min-width:0; }
.photo { width:27mm; height:27mm; border-radius:50%; object-fit:cover; object-position:50% 30%; flex-shrink:0; border:2px solid #fff; box-shadow:0 0 0 1px var(--line); }
header { grid-column:1/-1; display:flex; justify-content:space-between; align-items:center; gap:16px; border-bottom:2px solid var(--ink); padding-bottom:8px; margin-bottom:10px; }
h1 { font-size:22pt; line-height:1.05; margin:0; letter-spacing:-.02em; }
.role { color:var(--accent); font-weight:600; font-size:12pt; margin-top:3px; }
.contact { color:var(--muted); font-size:9pt; margin-top:5px; }
.contact a { color:var(--muted); }
.film { display:flex; align-items:center; gap:8px; text-decoration:none; color:var(--ink); border:1px solid var(--line); border-radius:14px; padding:6px 10px 6px 6px; flex-shrink:0; }
.film b { display:block; font-size:9pt; } .film span { font-size:8pt; color:var(--muted); }
h2 { font-size:9pt; text-transform:uppercase; letter-spacing:.12em; color:var(--accent); margin:12px 0 6px; }
.summary { margin:0 0 4px; }
.xp { margin-bottom:9px; break-inside:avoid; }
.xp-head { display:flex; justify-content:space-between; gap:8px; }
.xp-head strong { font-size:10.5pt; } .xp-head small { color:var(--muted); white-space:nowrap; }
.xp-co { color:var(--muted); font-size:9.2pt; }
ul { margin:3px 0 0; padding-left:15px; } li { margin:2px 0; }
li.rel::marker { color:var(--accent); }
aside .chip { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:1px 8px; margin:0 4px 4px 0; font-size:8.8pt; }
aside .chip.m { background:var(--hl); border-color:#f0d77a; font-weight:600; }
aside p { margin:0 0 5px; font-size:9.2pt; }
aside small { color:var(--muted); }
</style></head>
<body><div class="page">
<header>
  <div class="who">${photo ? `<img class="photo" src="${photo}" alt="">` : ''}<div>
    <h1>${h(id.firstName)} ${h(id.lastName)}</h1>
    <div class="role">${h(cv.title)}</div>
    <div class="contact">${contact.join(' · ')}${links.length ? ' · ' + links.join(' · ') : ''}</div>
  </div></div>
  ${filmUrl ? `<a class="film" href="${h(filmUrl)}" title="Voir mon parcours en film 3D">${FILM_ICON}<div><b>Mon CV en film 3D</b><span>Cliquez pour lancer ▶</span></div></a>` : ''}
</header>
<main>
  <h2>Profil</h2>
  <p class="summary">${h(cv.summary)}</p>
  <h2>Expérience</h2>
  ${cv.experiences.map(e => `<div class="xp">
    <div class="xp-head"><strong>${h(e.role)}</strong>${e.start ? `<small>${fmtDate(e.start)} – ${fmtDate(e.end)}</small>` : ''}</div>
    <div class="xp-co">${h(e.company)}${e.location ? ` · ${h(e.location)}` : ''}</div>
    <ul>${e.bullets.map(b => `<li${b.relevant ? ' class="rel"' : ''}>${h(b.text)}</li>`).join('')}</ul>
  </div>`).join('')}
</main>
<aside>
  <h2>Compétences</h2>
  <div>${cv.skills.map(s => `<span class="chip${s.matched ? ' m' : ''}">${h(s.name)}</span>`).join('')}</div>
  <h2>Formation</h2>
  ${cv.education.map(e => `<p><strong>${h(e.degree)}</strong><br><small>${h(e.school)} · ${e.start === e.end ? h(e.end) : `${h(e.start)}–${h(e.end)}`}</small></p>`).join('')}
  ${cv.languages?.length ? `<h2>Langues</h2>${cv.languages.map(l => `<p>${h(l.name)} <small>— ${h(l.level)}</small></p>`).join('')}` : ''}
  ${cv.interests?.length ? `<h2>Centres d'intérêt</h2><p>${cv.interests.map(h).join(' · ')}</p>` : ''}
</aside>
</div>
<script>
// Garantit une seule page A4 lors de la création du PDF : si le contenu dépasse (les polices varient selon
// la machine), on le resserre légèrement au lieu de déborder sur une deuxième page vide.
if (/HeadlessChrome/.test(navigator.userAgent) || navigator.webdriver) (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () {
  var page = document.querySelector('.page'), max = 297 * 96 / 25.4 - 4;
  page.style.minHeight = '0'; page.style.paddingBottom = '6mm';
  var hgt = page.getBoundingClientRect().height;
  if (hgt > max) page.style.zoom = Math.max(0.8, max / hgt).toFixed(3);
});
</script>
</body></html>`;
}

export function renderLetter(text, profile) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lettre — ${h(profile.identity.firstName)} ${h(profile.identity.lastName)}</title>
<style>@page{size:A4;margin:22mm} body{font:11pt/1.6 Georgia,"Times New Roman",serif;color:#161a22;max-width:170mm;margin:24px auto;padding:0 16px;white-space:pre-wrap}</style>
</head><body>${h(text)}</body></html>`;
}
