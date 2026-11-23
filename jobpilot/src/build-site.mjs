// Étape 3 : génère le site statique (GitHub Pages) dans site/.
//   /             → CV classique public (avec le pictogramme vers le film)
//   /cv3d/        → le CV en film 3D
//   /pilote/      → l'interface JobPilot (offres, suivi, profil, recherche, clés, robot)
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { renderCv } from './lib/render.mjs';

const root = new URL('..', import.meta.url);
const out = new URL('site/', root);
const profile = JSON.parse(await readFile(new URL('profile/profile.json', root), 'utf8'));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Profil public (utilisé par le film).
const { _note, ...publicProfile } = profile;
await writeFile(new URL('profile.json', out), JSON.stringify(publicProfile));

// Film 3D.
await cp(new URL('web/cv3d/', root), new URL('cv3d/', out), { recursive: true });

// CV classique (toutes les expériences, titre et résumé principaux).
const generic = {
  title: profile.titles[0].text,
  summary: profile.summaries[0].text,
  experiences: profile.experiences.map(e => ({ ...e, bullets: e.bullets.map(b => ({ text: b.text, relevant: false })) })),
  skills: [...profile.skills].sort((a, b) => b.level - a.level).map(s => ({ ...s, matched: false })),
  education: profile.education,
  languages: profile.languages,
  interests: profile.interests,
};
const photoBuf = await readFile(new URL('profile/photo.jpg', root)).catch(() => null);
if (photoBuf) await writeFile(new URL('photo.jpg', out), photoBuf);
await writeFile(new URL('index.html', out), renderCv(profile, generic, { filmUrl: 'cv3d/', photo: photoBuf ? 'photo.jpg' : null }));

// Interface de pilotage (les données sont lues via l'API GitHub avec le jeton de l'utilisateur :
// rien de personnel — offres, suivi, lettres — n'est publié sur le site).
await cp(new URL('web/pilote/', root), new URL('pilote/', out), { recursive: true });

await writeFile(new URL('robots.txt', out), 'User-agent: *\nDisallow: /pilote/\n');
await writeFile(new URL('.nojekyll', out), '');
console.log('Site généré dans site/ : CV, film 3D et interface de pilotage.');
