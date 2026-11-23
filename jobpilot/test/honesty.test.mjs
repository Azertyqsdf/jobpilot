import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tailorCv, honestyCheck, detectLang } from '../src/lib/tailor.mjs';
import { templateLetter, factCheck } from '../src/lib/letter.mjs';
import { scoreJob } from '../src/lib/match.mjs';
import { htmlToText } from '../src/lib/text.mjs';

const profile = JSON.parse(readFileSync(new URL('./fixtures/profile.sample.json', import.meta.url)));
const prefs = JSON.parse(readFileSync(new URL('./fixtures/preferences.sample.json', import.meta.url)));

const reactJob = { id: 'x', title: 'Développeur Front-End React (H/F)', company: 'Acme', location: 'Lyon', remote: false, tags: ['react'], postedAt: new Date().toISOString(),
  description: 'Nous recherchons un développeur React TypeScript passionné par l\'accessibilité et les design systems. Storybook apprécié. Kubernetes est un plus.' };
const backJob = { ...reactJob, title: 'Backend Engineer Node.js', tags: ['node', 'kubernetes'], description: 'You will build APIs with Node.js and PostgreSQL, Redis caching, CI with GitHub Actions.' };

test('le CV adapté ne contient que des textes du profil', () => {
  for (const job of [reactJob, backJob]) assert.deepEqual(honestyCheck(tailorCv(profile, job), profile), []);
});

test('un texte inventé est détecté', () => {
  const cv = tailorCv(profile, reactJob);
  cv.experiences[0].bullets.push({ text: 'Expert Kubernetes depuis 10 ans.' });
  assert.deepEqual(honestyCheck(cv, profile), ['Expert Kubernetes depuis 10 ans.']);
});

test("l'adaptation met en avant ce que l'offre demande", () => {
  const front = tailorCv(profile, reactJob);
  const back = tailorCv(profile, backJob);
  assert.match(front.title, /Front-End/);
  assert.match(back.title, /Back-End/);
  assert.equal(front.skills[0].matched, true);
  assert.ok(front.matched.includes('React'));
  assert.ok(back.missing.includes('kubernetes'), 'les compétences manquantes sont signalées, jamais ajoutées');
  assert.ok(!back.skills.some(s => /kubernetes/i.test(s.name)));
});

test('la lettre modèle passe le garde-fou, une lettre mensongère non', () => {
  const cv = tailorCv(profile, reactJob);
  assert.deepEqual(factCheck(templateLetter(profile, reactJob, cv), profile, reactJob), []);
  const lie = 'Madame, Monsieur,\nJ\'ai dirigé une équipe de 25 personnes chez Google pendant 8 ans.';
  const problems = factCheck(lie, profile, reactJob);
  assert.ok(problems.some(p => p.includes('25')));
  assert.ok(problems.some(p => p.includes('Google')));
});

test('notation et exclusions', () => {
  assert.ok(scoreJob(reactJob, profile, prefs).score >= prefs.minScore);
  assert.equal(scoreJob({ ...reactJob, title: 'Stage développeur React' }, profile, prefs).score, 0);
  assert.equal(scoreJob({ ...reactJob, location: 'New York', remote: false }, profile, prefs).score, 0);
});

test('outils texte', () => {
  assert.equal(htmlToText('&amp;lt;p&amp;gt;Bonjour &amp;amp; bienvenue&amp;lt;/p&amp;gt;'), 'Bonjour & bienvenue');
  assert.equal(detectLang(backJob.description), 'en');
  assert.equal(detectLang(reactJob.description), 'fr');
});
