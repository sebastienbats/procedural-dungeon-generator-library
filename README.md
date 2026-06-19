# 🏰 Générateur de Donjon Procédural
**Une bibliothèque JavaScript modulaire, sans dépendance, pour la génération procédurale de donjons avec rendu SVG.**

Inspirée de Gridmapper, elle propose un ensemble riche d’algorithmes, de tuiles personnalisables, de calques, d’annotations, de barre d’échelle, d’annulation/rétablissement, d’export et d’impression.

## ✨ Fonctionnalités
### Algorithmes de génération (7 intégrés)
- **🏠 Salles + couloirs en L** – salles rectangulaires classiques et couloirs en L.
- **🌳 BSP** – partitionnement binaire de l’espace pour des agencements hiérarchiques.
- **🌀 Couloirs sinueux** – chemins aléatoires sinueux avec salles occasionnelles.
- **🕳️ Automates cellulaires** – structures organiques de type caverne (règle B4/S3).
- **🚶 Drunkard’s Walk** – marches aléatoires multiples qui creusent des tunnels.
- **🌿 DLA Central Attractor** – agrégation limitée par diffusion, structures dendritiques.
- **🔄 DLA Symmetry** – DLA avec symétrie axiale (x, y ou les deux).
- **📐 Graph Grammar (avancé)** – réécriture de graphe avec règles personnalisables, supportant :
  - Salles en enfilade, symétries axiales/rotationnelles, niveaux hiérarchiques.
  - Couloirs larges, couloirs avec portes, passages secrets.
  - Règles entièrement redéfinissables par l’utilisateur.

### Fonctionnalités avancées
- **Calques superposés** – sol, murs, objets, annotations, couloirs… ajoutez vos propres calques.
- **Tuiles personnalisées** – définissez vos propres types avec couleurs et icônes (emojis/Unicode).
- **Annotations** – placez du texte (étiquettes) n’importe où.
- **Barre d’échelle** – affichez une échelle métrique ou personnalisée.
- **Annuler / Rétablir** – historique complet des modifications.
- **Export** – sauvegardez en SVG vectoriel ou PNG (via canvas).
- **Impression** – ouvrez une fenêtre optimisée pour l’impression.
- **Zéro dépendance** – 100% JavaScript pur, compatible avec tous les navigateurs modernes.

## 🎮 Démo en ligne
Un fichier **index.html** est fourni avec une interface interactive pour tester tous les algorithmes et paramètres. Ouvrez-le simplement dans votre navigateur.

## 📦 Installation
Copiez le fichier **dungeon-generator.js** dans votre projet.

## Cloner le dépôt
```bash
git clone https://github.com/sebastienbats/procedural-dungeon-generator-library.git
cd procedural-dungeon-generator-library
```
### Utilisation comme module ES6 :
```html
<script type="module">
  import { DungeonGenerator } from './dungeon-generator.js';
  // ...
</script>
```
### Utilisation classique (si vous le convertissez en IIFE) – non inclus par défaut.

## 🚀 Démarrage rapide
```javascript
const dungeon = new DungeonGenerator({
  container: document.getElementById('map'),
  tileSize: 32,
  width: 40,
  height: 30
});

// Générer un donjon avec l'algorithme "rooms"
dungeon.generate('rooms', {
  numRooms: 10,
  minRoomSize: 3,
  maxRoomSize: 6
});

// Ajouter une annotation
dungeon.addAnnotation(5, 5, 'Entrée', '#2c3e50', 14);

// Exporter en SVG
dungeon.exportSVG('mon_donjon.svg');
```
## 📚 Référence API
### Constructeur
```javascript
new DungeonGenerator(options)
```
|Option|Type|Défaut|Description|
|------|----|------|-----------|
|container|HTMLElement|document.body|Élément DOM qui contiendra le SVG.|
|tileSize|number|40|Taille en pixels d’une tuile.|
|width|number|50|Nombre de tuiles en largeur.|
|height|number|50|Nombre de tuiles en hauteur.|
|customTileTypes|Array<Object>|[]|Définitions de tuiles personnalisées (voir Personnalisation).|
### Méthodes principales
|Méthode|Description|
|-------|-----------|
|generate(algorithm, params, keepAnnotations = false)|Génère un donjon avec l’algorithme spécifié. algorithm peut être 'rooms', 'bsp', 'sinuous', 'cellular', 'drunkard', 'dla', 'dla-symmetry' ou 'graph-grammar'.|
|addTile(layerName, tileType, x, y, props = {})|Ajoute une tuile à un calque.|
|addAnnotation(x, y, text, color = '#000', fontSize = 12)|Ajoute une annotation textuelle.|
|setScale(visible, unit = 'm', pixelsPerUnit = 10)|Affiche/masque la barre d’échelle.|
|undo() / redo()|Annule ou rétablit la dernière action.|
|exportSVG(filename = 'donjon.svg')|Télécharge le donjon au format SVG.|
|exportPNG(filename = 'donjon.png')|Télécharge en PNG (via canvas).|
|print()|Ouvre une fenêtre d’impression.|
|registerGenerator(name, generatorFn)|Enregistre un nouvel algorithme personnalisé.|
## 🧩 Détail des algorithmes de génération
### Salles + couloirs en L (rooms)
- Place des salles rectangulaires aléatoires et les relie par des couloirs en L.
- Paramètres : numRooms, minRoomSize, maxRoomSize

### BSP (bsp)
- Partitionne récursivement l’espace en rectangles, place une salle dans chaque feuille, puis relie les salles.
- Paramètres : minRoomSize, maxRoomSize, maxDepth

### Couloirs sinueux (sinuous)
- Une marche aléatoire unique creuse un chemin sinueux en ajoutant occasionnellement des petites salles.
- Paramètres : steps, turnProbability, roomProbability, minRoomSize, maxRoomSize

### Automates cellulaires (cellular)
- Utilise un automate cellulaire (règle B4/S3) pour générer des cavernes organiques.
- Paramètres : density, iterations, birthLimit, deathLimit

### Drunkard’s Walk (drunkard)
- Plusieurs marcheurs aléatoires indépendants creusent des tunnels, avec une chance de créer des salles.
- Paramètres : steps, walkers, roomChance, directionChange, boundary

### DLA Central Attractor (dla)
- Agrégation limitée par diffusion : des particules marchent aléatoirement jusqu’à toucher une cellule occupée, formant des structures ramifiées.
- Paramètres : particles, radius, spawnRadius, maxAttempts

### DLA Symmetry (dla-symmetry)
- Même chose que DLA mais applique une symétrie axiale (x, y ou les deux) à chaque placement.
- Paramètres : particles, radius, spawnRadius, symmetry, maxAttempts

### Graph Grammar (avancé) (graph-grammar)
C’est l’algorithme le plus flexible. Il démarre avec un nœud racine et applique itérativement des règles de transformation sur le graphe. La bibliothèque fournit un ensemble de règles avancées (enfilade, symétrie, hiérarchie, couloirs larges, portes, etc.) que vous pouvez étendre ou remplacer entièrement.
Paramètres : iterations, spacing, maxNodes, startType, rules (tableau de fonctions)
Le contexte passé à chaque règle donne accès à :
- **node** – le nœud courant
- **createNode(x, y, type, level)** – ajoute une nouvelle salle (nœud)
- **addCorridor(nodeA, nodeB, type, props)** – trace un couloir (type : 'standard', 'large', 'door', 'secret')
- **addSymmetrical(node, axis)** – crée des symétriques
- **findFreeDirection(node)** – trouve une direction libre pour une nouvelle salle
- **isPositionFree(x, y)** – vérifie si une position est libre
- **solLayer, murLayer, corridorLayer** : calques pour dessiner
- **w, h** : dimensions du donjon
- **spacing** : espacement entre les salles

## 🎨 Personnalisation
### Tuiles personnalisées
Passez un tableau de définitions au constructeur :
```javascript
const customTiles = [
  { id: 'trésor', color: '#f1c40f', label: 'Trésor', icon: '💰' },
  { id: 'piège',  color: '#e74c3c', label: 'Piège',  icon: '⚔️' }
];
const dungeon = new DungeonGenerator({ customTileTypes: customTiles });
```
### Ajouter un calque
```javascript
dungeon.addLayer('mobilier', true);
dungeon.addTile('mobilier', 'trésor', 10, 10);
```
### Règles Graph Grammar personnalisées
Vous pouvez définir vos propres règles et les passer à generate :
```javascript
const mesRegles = [
  (ctx) => {
    const pos = ctx.findFreeDirection(ctx.node);
    if (pos) {
      const newNode = ctx.createNode(pos.x, pos.y, 'trésor');
      ctx.addCorridor(ctx.node, newNode, 'door', { hasDoor: true });
    }
  }
];

dungeon.generate('graph-grammar', {
  iterations: 10,
  rules: mesRegles,
  spacing: 4
});
```
## 🧭 Architecture du projet
La bibliothèque repose sur une classe unique DungeonGenerator. Ses composants principaux sont :
- **Registre des tuiles** – associe chaque type de tuile à une couleur et éventuellement une icône.
- **Système de calques** – chaque calque contient un tableau d’objets tuile et un indicateur de visibilité.
- **Historique** – sauvegarde des états de tous les calques pour annuler/rétablir.
- **Registre des générateurs** – un dictionnaire de fonctions de génération nommées.
- **Moteur de rendu SVG** – transforme les tuiles en éléments SVG.
- **Export / Impression** – sérialisation du SVG ou rendu sur canvas.
Le moteur **Graph Grammar** utilise un graphe interne de nœuds (salles) et applique des fonctions de règles qui peuvent modifier à la fois le graphe et les calques de tuiles.

## 📄 Exemple complet
Un fichier **index.html** est fourni avec une démo interactive comportant tous les contrôles et la sélection d’algorithme.

## 📜 Licence
MIT © Sébastien BATS

## 🎲 Amusez-vous à créer des donjons infinis ! 

