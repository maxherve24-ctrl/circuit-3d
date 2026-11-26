# 🏎️ Circuit 3D

Un jeu de course de voitures en 3D qui tourne dans le navigateur, sur PC comme sur téléphone.
- **Three.js** pour la 3D (lumière du soleil, ombres, ciel, arbres, tribune)
- Une **physique maison** : accélération, freinage, adhérence, dérapage au frein à main, perte de vitesse dans l'herbe
- **Firebase Firestore** pour le classement en ligne
- **Vercel** pour l'hébergement, **GitHub** pour le code

## Les fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | La page du jeu (menus, interface) |
| `style.css` | Le style |
| `main.js` | Le jeu : circuit, voiture, physique, caméra, son |
| `leaderboard.js` | Le classement (Firebase, ou local si Firebase n'est pas configuré) |
| `firebase-config.js` | **À remplir** avec les infos de ton projet Firebase |
| `firestore.rules` | Les règles de sécurité de la base de données |

Il n'y a rien à installer : pas de npm et pas de compilation.

---

## Étape 1 : GitHub
1. Va sur github.com, puis **New repository**. Nom : `circuit-3d`, en **Public** ou **Private**, puis **Create**.
2. Clique sur **uploading an existing file** et glisse **tous les fichiers** du dossier (pas le dossier lui-même).
3. Clique sur **Commit changes**.

## Étape 2 : Vercel (mettre le jeu en ligne)
1. Va sur vercel.com et connecte-toi **avec GitHub**.
2. Choisis **Add New… → Project**, puis **Import** à côté de `circuit-3d`.
3. Framework : **Other**. Ne touche à rien d'autre et clique sur **Deploy**.
4. Tu obtiens un lien du type `circuit-3d-xxx.vercel.app`. Le jeu marche déjà, avec un classement local.

À chaque modification sur GitHub, Vercel remet le jeu à jour tout seul.

## Étape 3 : Firebase (classement en ligne)
1. Va sur console.firebase.google.com et choisis **Créer un projet** (tu peux désactiver Google Analytics).
2. Menu **Build → Firestore Database → Créer une base de données**. Choisis la région `eur3 (Europe)`, puis le **mode production**.
3. Ouvre l'onglet **Règles**, remplace tout par le contenu de `firestore.rules`, puis clique sur **Publier**.
4. Va dans ⚙️ **Paramètres du projet**, puis **Vos applications**, et clique sur l'icône **Web `</>`**. Donne un nom à l'appli et enregistre-la.
5. Copie les valeurs de `firebaseConfig` (`apiKey`, `projectId`…) dans `firebase-config.js` sur GitHub (icône ✏️, puis **Commit**).
6. Attends environ 30 secondes que Vercel redéploie. Le menu affiche alors **Classement (en ligne)**. ✅

> La clé `apiKey` de Firebase n'est pas secrète, ce n'est pas grave qu'elle soit visible.
> Ce sont les règles Firestore qui protègent la base : on peut seulement ajouter des scores plausibles, pas les modifier ni les supprimer.

---

## Commandes
- **Clavier** : flèches ou ZQSD, **Espace** pour le frein à main (drift), **R** pour replacer la voiture sur la piste
- **Téléphone** : ◀ ▶ à gauche, **GAZ / FREIN / DRIFT** à droite

## Personnaliser
Tout en haut de `main.js` :
- `LAPS` : le nombre de tours
- `CAR` : la vitesse max, l'accélération, l'adhérence…
- `TRACK_POINTS` : le tracé du circuit (ajoute ou déplace des points pour inventer ton propre circuit)
- La couleur de la voiture se change dans `buildCar(0xc8102e)` (code couleur hexadécimal)
