// CV en film 3D : le parcours est mis en scène comme un court-métrage.
// Plans de caméra enchaînés, chapitres par expérience, sous-titres, constellation de compétences, générique.
import * as THREE from 'three';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const forCompany = params.get('pour');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const profile = await fetch('../profile.json').then(r => r.json());
const id = profile.identity;
const fullName = `${id.firstName} ${id.lastName}`;
document.title = `${fullName} — le film`;
$('startName').textContent = fullName;
if (forCompany) $('startKicker').textContent = `Projection privée pour ${forCompany}`;

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const fmt = d => { if (!d) return "aujourd'hui"; const [y, m] = String(d).split('-'); return m ? `${MONTHS[+m - 1]} ${y}` : y; };

// ---------------------------------------------------------------- scène
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070d');
scene.fog = new THREE.FogExp2('#05070d', 0.018);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);

scene.add(new THREE.HemisphereLight('#8aa4ff', '#1a1208', 0.6));
const key = new THREE.DirectionalLight('#ffe2a8', 1.2);
key.position.set(10, 20, 10);
scene.add(key);

const GOLD = new THREE.Color('#f5c542');
const BLUE = new THREE.Color('#5b7cff');

// Sol réfléchissant sombre + grille qui s'efface dans le brouillard.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: '#080b14', roughness: 0.35, metalness: 0.6 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -3;
scene.add(ground);
const grid = new THREE.GridHelper(800, 200, '#1d2a55', '#111a33');
grid.position.y = -2.98;
grid.material.transparent = true;
grid.material.opacity = 0.45;
scene.add(grid);

// Poussière lumineuse.
function dust(count, spread, zMin, zMax) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() - 0.5) * spread;
    p[i * 3 + 1] = Math.random() * 30 - 2;
    p[i * 3 + 2] = zMin + Math.random() * (zMax - zMin);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ size: 0.09, color: '#ffe9b0', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  return new THREE.Points(g, m);
}

// Texte → texture.
await document.fonts.load('300 80px Fraunces').catch(() => {});
await document.fonts.load('500 40px Inter').catch(() => {});
function wrap(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function panelTexture({ kicker, title, subtitle, lines = [] }) {
  const W = 1024, H = 600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(26,34,64,0.92)');
  g.addColorStop(1, 'rgba(8,10,20,0.92)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(4, 4, W - 8, H - 8, 36); ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,66,0.75)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#f5c542'; ctx.font = '500 30px Inter, sans-serif';
  ctx.fillText(String(kicker).toUpperCase().split('').join(String.fromCharCode(8202)), 60, 92);
  ctx.fillStyle = '#f3efe6'; ctx.font = '300 74px Fraunces, Georgia, serif';
  let y = 180;
  for (const l of wrap(ctx, title, W - 120).slice(0, 2)) { ctx.fillText(l, 60, y); y += 82; }
  ctx.fillStyle = '#b9b5ad'; ctx.font = '500 34px Inter, sans-serif';
  if (subtitle) { ctx.fillText(subtitle, 60, y + 4); y += 64; }
  ctx.font = '400 28px Inter, sans-serif'; ctx.fillStyle = '#d8d4cc';
  for (const l of lines) for (const w of wrap(ctx, l, W - 150).slice(0, 2)) { if (y > H - 40) break; ctx.fillText(w, 60, y + 10); y += 40; }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function textSprite(text, size, color = '#f3efe6') {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `500 64px Inter, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  c.width = w; c.height = 96;
  ctx.font = `500 64px Inter, sans-serif`;
  ctx.shadowColor = color; ctx.shadowBlur = 18;
  ctx.fillStyle = color; ctx.textBaseline = 'middle';
  ctx.fillText(text, 20, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(size * w / 96, size, 1);
  return s;
}
function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

// Une « station » = un panneau flottant + une colonne de lumière + un anneau au sol.
function station(pos, side, content) {
  const grp = new THREE.Group();
  grp.position.copy(pos);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 5), new THREE.MeshBasicMaterial({ map: panelTexture(content), transparent: true, side: THREE.DoubleSide }));
  panel.position.y = 1.6;
  panel.rotation.y = -side * 0.35;
  grp.add(panel);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.6, 40, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 17;
  grp.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.75, 64), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -2.95;
  grp.add(ring);
  const glow = glowSprite('rgba(245,197,66,0.6)', 5);
  glow.position.y = -2.6;
  grp.add(glow);
  grp.userData = { panel, ring };
  scene.add(grp);
  return grp;
}

// ---------------------------------------------------------------- mise en scène
// Ordre chronologique = récit ; les expériences sans date viennent en fin de film.
const xps = [...profile.experiences].sort((a, b) => (!a.start) - (!b.start) || String(a.start).localeCompare(String(b.start)));
const period = e => e.start ? `${fmt(e.start)} — ${fmt(e.end)}` : '';
const GAP = 34;
const stations = xps.map((e, i) => {
  const side = i % 2 ? 1 : -1;
  return station(new THREE.Vector3(side * 5, 0, -GAP * (i + 1)), side, {
    kicker: period(e) || e.location || '',
    title: e.role,
    subtitle: `${e.company}${e.location ? ' · ' + e.location : ''}`,
    lines: e.bullets.slice(0, 3).map(b => '— ' + b.text),
  });
});
const endZ = -GAP * (xps.length + 1);

// Chemin lumineux qui relie les étapes de la vie professionnelle.
{
  const pts = [new THREE.Vector3(0, -2.9, 20), ...stations.map(s => new THREE.Vector3(s.position.x, -2.9, s.position.z)), new THREE.Vector3(0, -2.9, endZ - 10)];
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 0.06, 8), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85 }));
  scene.add(tube);
  // Impulsion qui parcourt le chemin
  const pulse = glowSprite('rgba(245,197,66,0.9)', 2.2);
  scene.add(pulse);
  pulse.userData.curve = curve;
  scene.userData.pulse = pulse;
}
scene.add(dust(1800, 90, endZ - 80, 40));

// Constellation de compétences.
const C = new THREE.Vector3(0, 12, endZ - 20);
const constellation = new THREE.Group();
constellation.position.copy(C);
const skills = profile.skills || [];
skills.forEach((s, i) => {
  const phi = Math.acos(1 - 2 * (i + 0.5) / skills.length);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  const r = 7.5;
  const p = new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) * 0.75, r * Math.sin(phi) * Math.sin(theta));
  const star = glowSprite(i % 3 ? 'rgba(245,197,66,0.8)' : 'rgba(120,150,255,0.8)', 0.5 + (s.level || 3) * 0.22);
  star.position.copy(p);
  constellation.add(star);
  const label = textSprite(s.name, 0.55 + (s.level || 3) * 0.08);
  label.position.copy(p).add(new THREE.Vector3(0, -0.9, 0));
  constellation.add(label);
});
{ // liens entre étoiles proches
  const pos = constellation.children.filter((_, i) => i % 2 === 0).map(s => s.position);
  const seg = [];
  pos.forEach((a, i) => pos.forEach((b, j) => { if (j > i && a.distanceTo(b) < 6) seg.push(a.x, a.y, a.z, b.x, b.y, b.z); }));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  constellation.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.25 })));
}
scene.add(constellation);

// Formation : un dernier panneau, plus haut.
const eduPos = new THREE.Vector3(14, 2, C.z - 36);
const edu = (profile.education || []).length ? station(eduPos, 0, {
  kicker: 'Formation',
  title: profile.education[0].degree,
  subtitle: profile.education[0].school,
  lines: profile.education.slice(1).map(e => `${e.degree} — ${e.school} (${e.start}–${e.end})`),
}) : null;

// ---------------------------------------------------------------- découpage en plans
// Chaque plan : durée, position/visée de caméra d'arrivée, et ce qui s'affiche à l'écran en fonction du temps.
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const shots = [];
const mainTitle = profile.titles?.[0]?.text || '';
const mainSummary = profile.summaries?.[0]?.text || '';

shots.push({
  label: 'Ouverture', dur: 7, cam: V(0, 1.5, 22), look: V(0, 1, 0), from: { cam: V(0, 6, 46), look: V(0, 0, 0) },
  text: lt => ({ kicker: lt > 0.8 ? (forCompany ? `Pour ${forCompany}` : 'Un parcours en images') : '', headline: lt > 1.8 ? fullName : '', sub: lt > 3.5 ? mainTitle : '' }),
});
shots.push({
  label: 'Le personnage', dur: 8, cam: V(0, 1, 10), look: V(0, 0.5, -GAP),
  text: lt => ({ kicker: 'Synopsis', subtitle: lt > 0.8 ? mainSummary : '', who: fullName }),
});
xps.forEach((e, i) => {
  const st = stations[i];
  const side = i % 2 ? 1 : -1;
  const bullets = e.bullets.map(b => b.text);
  const per = 3.6;
  shots.push({
    label: `${i + 1}. ${e.company}`,
    dur: 3.8 + bullets.length * per,
    cam: st.position.clone().add(V(-side * 3.2, 1.6, 10)), look: st.position.clone().add(V(0, 0.7, 0)),
    station: st,
    text: lt => {
      if (lt < 3.8) return { kicker: `Chapitre ${i + 1}${period(e) ? ' · ' + period(e) : ''}`, headline: lt > 0.4 ? e.company : '', sub: lt > 1.2 ? e.role : '' };
      const k = Math.min(bullets.length - 1, Math.floor((lt - 3.8) / per));
      return { subtitle: bullets[k], who: `${e.role} · ${e.company}` };
    },
  });
});
if (skills.length) {
  const top = [...skills].sort((a, b) => b.level - a.level);
  const groups = [];
  for (let i = 0; i < top.length; i += 4) groups.push(top.slice(i, i + 4).map(s => s.name).join(' · '));
  shots.push({
    label: 'Compétences', dur: 4 + groups.length * 3, cam: C.clone().add(V(0, 0, 20)), look: C.clone().add(V(0, -2.2, 0)),
    text: lt => lt < 3.5 ? { kicker: 'Boîte à outils', headline: 'Compétences' } : { subtitle: groups[Math.min(groups.length - 1, Math.floor((lt - 3.5) / 3))], who: 'Ce que je maîtrise' },
  });
}
if (edu) shots.push({
  label: 'Formation', dur: 7, cam: eduPos.clone().add(V(0, 1.6, 10.5)), look: eduPos.clone().add(V(0, 0.8, 0)),
  text: lt => lt < 3 ? { kicker: 'Les fondations', headline: 'Formation' } : { subtitle: profile.education.map(e => `${e.degree} — ${e.school}`).join(' · '), who: 'Formation' },
});
shots.push({
  label: 'Générique', dur: 22, cam: V(0, 55, endZ / 2 + 70), look: V(0, 0, endZ / 2), credits: true,
  text: () => ({}),
});

let t0 = 0;
for (const [i, s] of shots.entries()) {
  s.start = t0; t0 += s.dur;
  if (!s.from) s.from = { cam: shots[i - 1].cam, look: shots[i - 1].look };
}
const TOTAL = t0;
document.querySelector('.start-hint').textContent = `≈ ${Math.max(1, Math.round(TOTAL / 30) / 2).toString().replace('.', ',')} min · Espace : pause · ← → : chapitres`;

// ---------------------------------------------------------------- textes à l'écran
const el = { kicker: $('kicker'), headline: $('headline'), sub: $('sub'), subtitle: $('subtitle') };
const shown = { kicker: '', headline: '', sub: '', subtitle: '', who: '' };
function setText(state) {
  document.body.classList.toggle('titling', !!state.headline);
  for (const k of ['kicker', 'headline', 'sub', 'subtitle']) {
    const v = state[k] || '';
    if (v === shown[k] && (k !== 'subtitle' || state.who === shown.who)) continue;
    shown[k] = v;
    const node = el[k];
    node.classList.remove('fade');
    void node.offsetWidth;
    node.textContent = v;
    if (v) node.classList.add('fade');
    if (k === 'subtitle') { shown.who = state.who || ''; node.dataset.who = shown.who; }
  }
}

// Générique de fin.
const credits = $('credits');
function buildCredits() {
  const section = (title, rows) => rows.length ? `<h3>${title}</h3>${rows.map(r => `<p>${r}</p>`).join('')}` : '';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const links = [
    id.email && `<a href="mailto:${esc(id.email)}">Me contacter</a>`,
    id.linkedin && `<a class="ghost" href="${esc(id.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`,
    id.github && `<a class="ghost" href="${esc(id.github)}" target="_blank" rel="noopener">GitHub</a>`,
    `<a class="ghost" href="../">CV classique</a>`,
    `<a class="ghost" href="#" id="replay">Revoir le film</a>`,
  ].filter(Boolean).join('');
  credits.innerHTML = `<div class="roll" id="roll">
    <h3>Dans le rôle principal</h3><p style="font-family:Fraunces,serif;font-size:clamp(28px,4vw,44px)">${esc(fullName)}</p>
    ${section('Avec la participation de', xps.slice().reverse().map(e => `${esc(e.company)} <span style="color:var(--dim)">— ${esc(e.role)}</span>`))}
    ${section('Compétences', [skills.map(s => esc(s.name)).join(' · ')])}
    ${section('Langues', (profile.languages || []).map(l => `${esc(l.name)} <span style="color:var(--dim)">— ${esc(l.level)}</span>`))}
    ${section('Hors champ', [(profile.interests || []).map(esc).join(' · ')])}
    ${section('Tournage', [esc(id.city || '')])}
  </div>
  <div class="final" id="final"><div class="fin">Et la suite ?</div><p style="color:var(--dim);margin:0">${forCompany ? `Elle pourrait s'écrire chez ${esc(forCompany)}.` : 'Elle pourrait s\'écrire avec vous.'}</p><div class="links">${links}</div></div>`;
  $('replay').addEventListener('click', e => { e.preventDefault(); seek(0); play(); });
}
buildCredits();
const roll = $('roll');
const final = $('final');

// ---------------------------------------------------------------- lecture
let T = 0, playing = false, last = performance.now();
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const tmpCam = new THREE.Vector3(), tmpLook = new THREE.Vector3();

function shotAt(t) { return shots.find(s => t < s.start + s.dur) || shots[shots.length - 1]; }
function seek(t) { T = Math.max(0, Math.min(TOTAL, t)); }
function play() { playing = true; document.body.classList.add('playing'); document.body.classList.remove('paused'); $('toggle').textContent = '❚❚'; $('toggle').setAttribute('aria-label', 'Pause'); }
function pause() { playing = false; document.body.classList.add('paused'); $('toggle').textContent = '▶'; $('toggle').setAttribute('aria-label', 'Lecture'); }

// Marques de chapitres sur la barre de progression.
const track = $('track');
for (const s of shots.slice(1)) {
  const m = document.createElement('div');
  m.className = 'mark';
  m.style.left = `${(100 * s.start) / TOTAL}%`;
  track.appendChild(m);
}
track.addEventListener('click', e => { const r = track.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * TOTAL); });
track.addEventListener('keydown', e => { if (e.key === 'ArrowRight') jump(1); if (e.key === 'ArrowLeft') jump(-1); });
function jump(dir) {
  const i = shots.indexOf(shotAt(T));
  const target = shots[Math.max(0, Math.min(shots.length - 1, i + dir))];
  seek(dir < 0 && T - shots[i].start > 2 ? shots[i].start : target.start);
}
$('toggle').addEventListener('click', () => (playing ? pause() : play()));
$('skip').addEventListener('click', () => { seek(shots[shots.length - 1].start); play(); });
addEventListener('keydown', e => {
  if ($('start').classList.contains('gone') === false) return;
  if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
  if (e.key === 'ArrowRight') jump(1);
  if (e.key === 'ArrowLeft') jump(-1);
});

const playBtn = $('play');
playBtn.disabled = false;
playBtn.addEventListener('click', () => {
  $('start').classList.add('gone');
  $('controls').hidden = false;
  setTimeout(() => { seek(+(params.get('t') || 0)); play(); }, 300);
});
// ?t=42 : démarre directement à la 42e seconde (pratique pour partager un chapitre).
if (params.has('t')) playBtn.click();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Sur téléphone (portrait), on recule pour garder les panneaux dans le cadre.
  camera.fov = w < h ? 70 : 50;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) { T += dt; if (T >= TOTAL) { T = TOTAL; } }

  const s = shotAt(T);
  const lt = T - s.start;
  const k = ease(Math.min(1, lt / Math.min(s.dur, reduced ? 2 : 4.5)));
  tmpCam.lerpVectors(s.from.cam, s.cam, k);
  tmpLook.lerpVectors(s.from.look, s.look, k);
  // Mouvement de grue : la caméra s'élève en arc entre deux plans pour passer au-dessus des panneaux.
  if (s.station) tmpCam.y += Math.sin(Math.PI * k) * 6;
  if (camera.aspect < 1) tmpCam.sub(tmpLook).multiplyScalar(Math.min(1.8, 0.75 / camera.aspect)).add(tmpLook); // recul en portrait
  if (!reduced) { // respiration de caméra à l'épaule
    tmpCam.x += Math.sin(now / 2100) * 0.25;
    tmpCam.y += Math.sin(now / 1700) * 0.15;
    if (s.credits) tmpCam.z -= lt * 0.6;
  }
  camera.position.copy(tmpCam);
  camera.lookAt(tmpLook);

  setText(s.text(lt));

  // Générique : défilement puis carton final.
  const inCredits = !!s.credits;
  credits.hidden = !inCredits;
  if (inCredits) {
    const H = roll.offsetHeight + credits.offsetHeight;
    roll.style.transform = `translateY(${-Math.min(lt / (s.dur - 4), 1) * H}px)`;
    final.classList.toggle('show', lt > s.dur - 4.5);
    if (T >= TOTAL && playing) pause();
  }
  document.body.classList.toggle('cinema', $('start').classList.contains('gone') && !(inCredits && lt > s.dur - 4.5));

  // Vie de la scène.
  const time = now / 1000;
  constellation.rotation.y = time * 0.08;
  stations.forEach((st, i) => {
    const active = s.station === st;
    st.userData.panel.position.y = 1.6 + Math.sin(time * 0.8 + i) * 0.12;
    st.userData.ring.scale.setScalar(1 + (active ? 0.15 * Math.sin(time * 3) + 0.2 : 0));
  });
  const pulse = scene.userData.pulse;
  pulse.position.copy(pulse.userData.curve.getPointAt((time * 0.05) % 1)).add(V(0, 0.2, 0));

  $('fill').style.width = `${(100 * T) / TOTAL}%`;
  $('chapter').textContent = s.label;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
