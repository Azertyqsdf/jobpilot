# JobPilot

JobPilot cherche les offres d'emploi qui te correspondent, adapte ton CV à chacune sans rien inventer, prépare ta candidature et accompagne ton CV d'un **film en 3D**. Tout tourne gratuitement sur GitHub (Actions + Pages) : pas de serveur, pas d'abonnement.

## Ce que fait le robot

| Étape | Quand | Ce qui se passe |
|---|---|---|
| 🔎 Recherche | chaque matin (et à chaque modification du profil) | Récupère les offres (Arbeitnow, Remotive, France Travail, Adzuna), écarte les stages, les lieux hors zone et les offres trop anciennes, puis note chaque offre de 0 à 100 selon tes compétences. |
| 🖥️ Interface | à tout moment | `…/pilote/` : offres notées et bouton **Postuler** ; **suivi** des candidatures (à envoyer → envoyée → entretien → terminée, notes, rappels de relance, candidatures faites ailleurs) ; édition du **profil** et de la **recherche** ; **clés** enregistrées chiffrées ; état du **robot**. Les données sont lues par l'API GitHub avec ton jeton personnel : rien de privé n'est publié sur le site. |
| ✂️ CV adapté | quand tu cliques sur « Postuler » | Le moteur choisit, parmi tes titres, résumés et réalisations **vrais**, ceux qui parlent le plus à l'offre. Il les réordonne, met en avant les compétences demandées, puis produit le CV et la lettre en PDF. |
| 📬 Envoi | si l'offre donne un e-mail de candidature | La candidature part par e-mail depuis ton adresse (si tu l'as activé). Sinon, tu ouvres le lien de l'offre et tu joins le PDF : 30 secondes. |
| 🎬 Film 3D | toujours | Chaque CV porte un pictogramme qui ouvre `…/cv3d/?pour=<Entreprise>` : ton parcours mis en scène comme un court-métrage (générique, chapitres, sous-titres, constellation de compétences). |

### La règle « sans mentir » est garantie par le code
- Le CV adapté ne contient **que des phrases qui existent mot pour mot** dans `profile/profile.json`. Le contrôle `honestyCheck` bloque la candidature si ce n'est pas le cas.
- Les compétences que demande l'offre et que tu n'as pas sont **signalées, jamais ajoutées**.
- Avec une clé Gemini (facultative), l'IA rédige la lettre. Un garde-fou la rejette si elle contient un chiffre ou un nom propre absent de ton profil ou de l'offre ; c'est alors la lettre modèle, construite à partir de tes faits, qui part.

## Mise en route (≈ 10 minutes, une seule fois)

1. **Ton profil** : `profile/profile.json` (déjà rempli à partir de ton CV ; un exemple fictif est dans `test/fixtures/`). Plus tu ajoutes de variantes **vraies** (plusieurs titres, plusieurs résumés, des puces avec des `tags`), mieux le moteur adapte.
2. **Ce que tu cherches** : `profile/preferences.json` (mots-clés, villes, mots à exclure, note minimale).
3. **Activer le site** : sur GitHub, *Settings → Pages → Source : « GitHub Actions »*.
4. **Ouvrir l'interface** `https://<ton-compte>.github.io/<dépôt>/pilote/` et suivre l'écran de connexion (création d'un jeton GitHub, une seule fois). Tout le reste se règle depuis l'interface.

### Options gratuites (onglet « Clés & envoi » de l'interface)
| Secret | À quoi ça sert | Où l'obtenir (gratuit) |
|---|---|---|
| `FT_CLIENT_ID`, `FT_CLIENT_SECRET` | Offres France Travail, souvent avec un e-mail de recrutement | francetravail.io → créer une application → API « Offres d'emploi v2 » |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Agrégateur de milliers de sites français | developer.adzuna.com |
| `GEMINI_API_KEY` | Lettre rédigée par l'IA dans la langue de l'offre | aistudio.google.com → Get API key (offre gratuite) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Envoi automatique des candidatures par e-mail | Gmail : `smtp.gmail.com`, `465`, ton adresse, un *mot de passe d'application* |
| `CV_PHONE` | Ton numéro, ajouté **uniquement dans les PDF envoyés** (jamais sur le site public) | — |
| Variable `AUTO_SEND` = `true` | Autorise l'envoi automatique (désactivé par défaut) | — |

## Limites (honnêtement)
- **LinkedIn, Indeed, Welcome to the Jungle** interdisent les robots dans leurs conditions d'utilisation et bloquent la candidature automatique. Pour ces offres, JobPilot prépare tout et tu cliques sur « Envoyer » toi-même.
- Le site GitHub Pages est **public**, mais il ne contient que ton CV, ton film et l'interface vide : offres, suivi et lettres sont lus à la demande, avec ton jeton, depuis le dépôt.

## En local
```bash
npm install
npm run fetch            # offres → data/jobs.json
npm run apply -- <id>    # candidature → data/applications/…
npm run build            # site → site/
npm test                 # dont le contrôle anti-mensonge
```
