/**
 * dungeon-generator.js
 * Bibliothèque de génération procédurale de donjons
 * Version complète avec tous les algorithmes, tuiles personnalisées,
 * calques, annotations, échelle, undo/redo, export et impression.
 * Inclut l'algorithme Graph Grammar avancé avec couloirs, symétries, hiérarchies.
 *
 * Inspirée de Gridmapper (https://src.alexschroeder.ch/gridmapper.git)
 */

class DungeonGenerator {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Élément DOM qui contiendra le SVG
   * @param {number} options.tileSize - Taille en pixels d'une tuile (défaut: 40)
   * @param {number} options.width - Nombre de tuiles en largeur (défaut: 50)
   * @param {number} options.height - Nombre de tuiles en hauteur (défaut: 50)
   * @param {Array} options.customTileTypes - Définition de tuiles personnalisées
   *   Chaque élément : { id, color, label, icon? }
   */
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.tileSize = options.tileSize || 40;
    this.width = options.width || 50;
    this.height = options.height || 50;

    // Registre des types de tuiles (par défaut + personnalisées)
    this.tileRegistry = this.buildTileRegistry(options.customTileTypes || []);

    // Calques (ordre de superposition : premier en bas, dernier en haut)
    this.layers = [];
    this.addLayer('sol', true);
    this.addLayer('murs', true);
    this.addLayer('objets', true);
    this.addLayer('annotations', true);
    this.addLayer('couloirs', true); // calque pour les métadonnées des couloirs

    // Annotations (stockées séparément pour faciliter le rendu)
    this.annotations = [];

    // Échelle
    this.scaleBar = { visible: true, unit: 'm', pixelsPerUnit: 10 };

    // Historique pour undo/redo
    this.history = [];
    this.historyIndex = -1;

    // Registre des générateurs
    this.generators = {};
    this.registerGenerator('rooms', this.generateRoomsAndCorridors.bind(this));
    this.registerGenerator('bsp', this.generateBSP.bind(this));
    this.registerGenerator('sinuous', this.generateSinuousCorridors.bind(this));
    this.registerGenerator('cellular', this.generateCellular.bind(this));
    this.registerGenerator('drunkard', this.generateDrunkardWalk.bind(this));
    this.registerGenerator('dla', this.generateDLA.bind(this));
    this.registerGenerator('dla-symmetry', this.generateDLASymmetry.bind(this));
    this.registerGenerator('graph-grammar', this.generateGraphGrammar.bind(this));

    // Initialisation du SVG
    this.svg = null;
    this.initSVG();
  }

  // --------------------------------------------------------------
  // 1. Gestion des tuiles et calques
  // --------------------------------------------------------------

  buildTileRegistry(customTypes) {
    const base = {
      'sol': { color: '#d4c3a3', label: 'Sol' },
      'mur': { color: '#5a4a3a', label: 'Mur' },
      'porte': { color: '#8b5a2b', label: 'Porte' },
      'corridor': { color: '#b8a48c', label: 'Corridor' },
      'eau': { color: '#4a90d9', label: 'Eau' },
      'vide': { color: '#f0ece6', label: 'Vide' },
      'annotation': { color: 'transparent', label: 'Annotation' }
    };
    customTypes.forEach(type => {
      base[type.id] = { color: type.color, label: type.label, icon: type.icon };
    });
    return base;
  }

  addLayer(name, visible = true) {
    const layer = { name, visible, tiles: [] };
    this.layers.push(layer);
    return layer;
  }

  getLayer(name) {
    return this.layers.find(l => l.name === name);
  }

  /**
   * Ajoute une tuile à un calque.
   * @param {string} layerName - Nom du calque
   * @param {string} tileType - Type de tuile (doit exister dans le registre)
   * @param {number} x - Coordonnée en grille
   * @param {number} y - Coordonnée en grille
   * @param {Object} props - Propriétés supplémentaires (rotation, texte, etc.)
   */
  addTile(layerName, tileType, x, y, props = {}) {
    const layer = this.getLayer(layerName);
    if (!layer) throw new Error(`Calque "${layerName}" inexistant`);
    const tile = { type: tileType, x, y, ...props };
    layer.tiles.push(tile);
    this.pushHistory();
    this.render();
  }

  /**
   * Récupère toutes les tuiles d'un calque à une position donnée.
   */
  getTilesAt(layerName, x, y) {
    const layer = this.getLayer(layerName);
    if (!layer) return [];
    return layer.tiles.filter(t => t.x === x && t.y === y);
  }

  // --------------------------------------------------------------
  // 2. Annotations
  // --------------------------------------------------------------

  addAnnotation(x, y, text, color = '#000', fontSize = 12) {
    const ann = { x, y, text, color, fontSize };
    this.annotations.push(ann);
    this.addTile('annotations', 'annotation', x, y, { text, color, fontSize });
    this.pushHistory();
    this.render();
  }

  // --------------------------------------------------------------
  // 3. Échelle
  // --------------------------------------------------------------

  setScale(visible = true, unit = 'm', pixelsPerUnit = 10) {
    this.scaleBar.visible = visible;
    this.scaleBar.unit = unit;
    this.scaleBar.pixelsPerUnit = pixelsPerUnit;
    this.render();
  }

  // --------------------------------------------------------------
  // 4. Génération procédurale - architecture
  // --------------------------------------------------------------

  registerGenerator(name, generatorFn) {
    this.generators[name] = generatorFn;
  }

  /**
   * Génère un donjon en utilisant l'algorithme spécifié.
   * @param {string} algorithm - Nom de l'algorithme enregistré
   * @param {Object} params - Paramètres spécifiques à l'algorithme
   * @param {boolean} keepAnnotations - Conserver les annotations existantes (défaut: false)
   */
  generate(algorithm, params = {}, keepAnnotations = false) {
    if (!this.generators[algorithm]) {
      throw new Error(`Algorithme "${algorithm}" non trouvé`);
    }
    this.clearAll(!keepAnnotations);
    this.generators[algorithm](this, params);
    this.placeWalls();
    this.cleanWalls();
    this.pushHistory();
    this.render();
  }

  // --------------------------------------------------------------
  // 5. Algorithmes de génération (de base)
  // --------------------------------------------------------------

  /**
   * Algorithme "rooms" : salles rectangulaires + couloirs en L.
   */
  generateRoomsAndCorridors(dungeon, params) {
    const numRooms = params.numRooms || 8;
    const minSize = params.minRoomSize || 3;
    const maxSize = params.maxRoomSize || 6;

    const solLayer = dungeon.getLayer('sol');
    const murLayer = dungeon.getLayer('murs');

    // Remplir le sol de vide
    for (let y = 0; y < dungeon.height; y++) {
      for (let x = 0; x < dungeon.width; x++) {
        solLayer.tiles.push({ type: 'vide', x, y });
      }
    }

    const rooms = [];
    for (let i = 0; i < numRooms; i++) {
      const w = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
      const h = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
      const x = Math.floor(Math.random() * (dungeon.width - w - 2)) + 1;
      const y = Math.floor(Math.random() * (dungeon.height - h - 2)) + 1;
      const room = { x, y, w, h };
      let collision = false;
      for (const r of rooms) {
        if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) {
          collision = true;
          break;
        }
      }
      if (!collision) {
        rooms.push(room);
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const gx = x + dx, gy = y + dy;
            solLayer.tiles = solLayer.tiles.filter(t => !(t.x === gx && t.y === gy));
            solLayer.tiles.push({ type: 'sol', x: gx, y: gy });
          }
        }
      }
    }

    for (let i = 0; i < rooms.length - 1; i++) {
      const r1 = rooms[i];
      const r2 = rooms[i + 1];
      const cx1 = r1.x + Math.floor(r1.w / 2);
      const cy1 = r1.y + Math.floor(r1.h / 2);
      const cx2 = r2.x + Math.floor(r2.w / 2);
      const cy2 = r2.y + Math.floor(r2.h / 2);
      dungeon.corridorBetween(cx1, cy1, cx2, cy2, solLayer, murLayer);
    }
  }

  /**
   * Algorithme BSP (Binary Space Partitioning).
   */
  generateBSP(dungeon, params) {
    const minRoomSize = params.minRoomSize || 4;
    const maxRoomSize = params.maxRoomSize || 8;
    const maxDepth = params.maxDepth || 6;

    const solLayer = dungeon.getLayer('sol');
    const murLayer = dungeon.getLayer('murs');

    function split(rect, depth) {
      if (depth >= maxDepth || rect.w < minRoomSize * 2 || rect.h < minRoomSize * 2) {
        const roomW = Math.floor(Math.random() * (maxRoomSize - minRoomSize + 1)) + minRoomSize;
        const roomH = Math.floor(Math.random() * (maxRoomSize - minRoomSize + 1)) + minRoomSize;
        const x = rect.x + Math.floor(Math.random() * (rect.w - roomW));
        const y = rect.y + Math.floor(Math.random() * (rect.h - roomH));
        return { room: { x, y, w: roomW, h: roomH }, children: [] };
      }

      const horizontal = Math.random() < 0.5;
      const splitPos = Math.floor(Math.random() * (horizontal ? rect.h : rect.w) * 0.6 + 0.2 * (horizontal ? rect.h : rect.w));
      let left, right;
      if (horizontal) {
        left = { x: rect.x, y: rect.y, w: rect.w, h: splitPos };
        right = { x: rect.x, y: rect.y + splitPos, w: rect.w, h: rect.h - splitPos };
      } else {
        left = { x: rect.x, y: rect.y, w: splitPos, h: rect.h };
        right = { x: rect.x + splitPos, y: rect.y, w: rect.w - splitPos, h: rect.h };
      }
      const leftResult = split(left, depth + 1);
      const rightResult = split(right, depth + 1);
      return { children: [leftResult, rightResult], room: null };
    }

    const root = split({ x: 1, y: 1, w: dungeon.width - 2, h: dungeon.height - 2 }, 0);

    const rooms = [];
    function collectRooms(node) {
      if (node.room) {
        rooms.push(node.room);
      } else {
        for (const child of node.children) collectRooms(child);
      }
    }
    collectRooms(root);

    for (const room of rooms) {
      for (let dy = 0; dy < room.h; dy++) {
        for (let dx = 0; dx < room.w; dx++) {
          const gx = room.x + dx, gy = room.y + dy;
          solLayer.tiles = solLayer.tiles.filter(t => !(t.x === gx && t.y === gy));
          solLayer.tiles.push({ type: 'sol', x: gx, y: gy });
        }
      }
    }

    for (let i = 0; i < rooms.length - 1; i++) {
      const r1 = rooms[i];
      const r2 = rooms[i + 1];
      const cx1 = r1.x + Math.floor(r1.w / 2);
      const cy1 = r1.y + Math.floor(r1.h / 2);
      const cx2 = r2.x + Math.floor(r2.w / 2);
      const cy2 = r2.y + Math.floor(r2.h / 2);
      dungeon.corridorBetween(cx1, cy1, cx2, cy2, solLayer, murLayer);
    }
  }

  /**
   * Algorithme "sinuous" : couloirs sinueux avec salles aléatoires.
   */
  generateSinuousCorridors(dungeon, params) {
    const steps = params.steps || 200;
    const turnProbability = params.turnProbability || 0.3;
    const roomProbability = params.roomProbability || 0.05;
    const minRoomSize = params.minRoomSize || 2;
    const maxRoomSize = params.maxRoomSize || 4;

    const solLayer = dungeon.getLayer('sol');
    const murLayer = dungeon.getLayer('murs');

    let x = Math.floor(dungeon.width / 2);
    let y = Math.floor(dungeon.height / 2);
    let dir = Math.floor(Math.random() * 4);
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];

    for (let i = 0; i < steps; i++) {
      if (Math.random() < turnProbability) {
        const turn = Math.random() < 0.5 ? 1 : -1;
        dir = (dir + turn + 4) % 4;
      }
      const dx = dirs[dir][0], dy = dirs[dir][1];
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || nx >= dungeon.width - 1 || ny < 1 || ny >= dungeon.height - 1) {
        dir = (dir + 2) % 4;
        continue;
      }
      x = nx; y = ny;
      solLayer.tiles = solLayer.tiles.filter(t => !(t.x === x && t.y === y));
      solLayer.tiles.push({ type: 'sol', x, y });
      murLayer.tiles = murLayer.tiles.filter(t => !(t.x === x && t.y === y));

      if (Math.random() < roomProbability) {
        const w = Math.floor(Math.random() * (maxRoomSize - minRoomSize + 1)) + minRoomSize;
        const h = Math.floor(Math.random() * (maxRoomSize - minRoomSize + 1)) + minRoomSize;
        const rx = x - Math.floor(w / 2);
        const ry = y - Math.floor(h / 2);
        for (let dy2 = 0; dy2 < h; dy2++) {
          for (let dx2 = 0; dx2 < w; dx2++) {
            const gx = rx + dx2, gy = ry + dy2;
            if (gx >= 1 && gx < dungeon.width - 1 && gy >= 1 && gy < dungeon.height - 1) {
              solLayer.tiles = solLayer.tiles.filter(t => !(t.x === gx && t.y === gy));
              solLayer.tiles.push({ type: 'sol', x: gx, y: gy });
              murLayer.tiles = murLayer.tiles.filter(t => !(t.x === gx && t.y === gy));
            }
          }
        }
      }
    }
  }

  /**
   * Algorithme "cellular" : automates cellulaires pour cavernes.
   */
  generateCellular(dungeon, params) {
    const density = params.density ?? 0.45;
    const iterations = params.iterations ?? 4;
    const birthLimit = params.birthLimit ?? 4;
    const deathLimit = params.deathLimit ?? 3;

    const w = dungeon.width;
    const h = dungeon.height;

    let grid = Array(h).fill().map(() => Array(w).fill(false));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        grid[y][x] = Math.random() < density;
      }
    }

    function countNeighbors(g, x, y) {
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
            count++;
          } else if (g[ny][nx]) {
            count++;
          }
        }
      }
      return count;
    }

    for (let iter = 0; iter < iterations; iter++) {
      const newGrid = Array(h).fill().map(() => Array(w).fill(false));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const neighbors = countNeighbors(grid, x, y);
          if (grid[y][x]) {
            newGrid[y][x] = neighbors >= deathLimit;
          } else {
            newGrid[y][x] = neighbors > birthLimit;
          }
        }
      }
      grid = newGrid;
    }

    const solLayer = dungeon.getLayer('sol');
    const murLayer = dungeon.getLayer('murs');
    solLayer.tiles = [];
    murLayer.tiles = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y][x]) {
          murLayer.tiles.push({ type: 'mur', x, y });
        } else {
          solLayer.tiles.push({ type: 'sol', x, y });
        }
      }
    }
  }

  /**
   * Algorithme Drunkard's Walk : marches aléatoires.
   */
  generateDrunkardWalk(dungeon, params) {
    const steps = params.steps ?? 500;
    const walkers = params.walkers ?? 3;
    const startX = params.startX ?? Math.floor(dungeon.width / 2);
    const startY = params.startY ?? Math.floor(dungeon.height / 2);
    const roomChance = params.roomChance ?? 0.02;
    const directionChange = params.directionChange ?? 0.3;
    const boundary = params.boundary ?? 2;

    const solLayer = dungeon.getLayer('sol');
    const murLayer = dungeon.getLayer('murs');
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];

    for (let w = 0; w < walkers; w++) {
      let x = startX + Math.floor(Math.random() * 10 - 5);
      let y = startY + Math.floor(Math.random() * 10 - 5);
      let dir = Math.floor(Math.random() * 4);
      x = Math.max(boundary, Math.min(dungeon.width - boundary - 1, x));
      y = Math.max(boundary, Math.min(dungeon.height - boundary - 1, y));

      for (let i = 0; i < steps; i++) {
        if (Math.random() < directionChange) {
          const turn = Math.random() < 0.5 ? 1 : -1;
          dir = (dir + turn + 4) % 4;
        }
        const dx = dirs[dir][0];
        const dy = dirs[dir][1];
        let nx = x + dx;
        let ny = y + dy;

        if (nx < boundary || nx >= dungeon.width - boundary || ny < boundary || ny >= dungeon.height - boundary) {
          dir = Math.floor(Math.random() * 4);
          nx = x + dirs[dir][0];
          ny = y + dirs[dir][1];
          if (nx < boundary || nx >= dungeon.width - boundary || ny < boundary || ny >= dungeon.height - boundary) {
            continue;
          }
        }
        x = nx;
        y = ny;

        solLayer.tiles = solLayer.tiles.filter(t => !(t.x === x && t.y === y));
        solLayer.tiles.push({ type: 'sol', x, y });
        murLayer.tiles = murLayer.tiles.filter(t => !(t.x === x && t.y === y));

        if (Math.random() < roomChance) {
          const roomSize = Math.floor(Math.random() * 3) + 2;
          const rx = x - Math.floor(roomSize / 2);
          const ry = y - Math.floor(roomSize / 2);
          for (let dy2 = 0; dy2 < roomSize; dy2++) {
            for (let dx2 = 0; dx2 < roomSize; dx2++) {
              const gx = rx + dx2, gy = ry + dy2;
              if (gx >= boundary && gx < dungeon.width - boundary && gy >= boundary && gy < dungeon.height - boundary) {
                solLayer.tiles = solLayer.tiles.filter(t => !(t.x === gx && t.y === gy));
                solLayer.tiles.push({ type: 'sol', x: gx, y: gy });
                murLayer.tiles = murLayer.tiles.filter(t => !(t.x === gx && t.y === gy));
              }
            }
          }
        }
      }
    }
  }

  /**
   * Algorithme DLA (Diffusion-Limited Aggregation) standard.
   */
  generateDLA(dungeon, params) {
    const particles = params.particles ?? 200;
    const radius = params.radius ?? 5;
    const spawnRadius = params.spawnRadius ?? Math.max(dungeon.width, dungeon.height) / 2;
    const maxAttempts = params.maxAttempts ?? 1000;

    const solLayer = dungeon.getLayer('sol');
    const murLayer = dungeon.getLayer('murs');
    solLayer.tiles = [];
    murLayer.tiles = [];

    const w = dungeon.width;
    const h = dungeon.height;
    const centerX = Math.floor(w / 2);
    const centerY = Math.floor(h / 2);

    const occupied = Array(h).fill().map(() => Array(w).fill(false));

    function setOccupied(x, y) {
      if (x < 0 || x >= w || y < 0 || y >= h) return false;
      if (occupied[y][x]) return false;
      occupied[y][x] = true;
      solLayer.tiles.push({ type: 'sol', x, y });
      return true;
    }

    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (x*x + y*y <= radius*radius) {
          const px = centerX + x;
          const py = centerY + y;
          if (px >= 0 && px < w && py >= 0 && py < h) {
            setOccupied(px, py);
          }
        }
      }
    }

    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];

    for (let p = 0; p < particles; p++) {
      let placed = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const angle = Math.random() * 2 * Math.PI;
        const dist = Math.floor(Math.random() * spawnRadius) + 1;
        let x = centerX + Math.floor(Math.cos(angle) * dist);
        let y = centerY + Math.floor(Math.sin(angle) * dist);
        if (x < 0 || x >= w || y < 0 || y >= h) continue;

        let walkSteps = 0;
        while (walkSteps < 1000) {
          let adjacent = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h && occupied[ny][nx]) {
                adjacent = true;
                break;
              }
            }
            if (adjacent) break;
          }
          if (adjacent) {
            if (setOccupied(x, y)) {
              placed = true;
            }
            break;
          }
          const dir = Math.floor(Math.random() * 4);
          const nx = x + dirs[dir][0];
          const ny = y + dirs[dir][1];
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            x = nx;
            y = ny;
          }
          walkSteps++;
        }
        if (placed) break;
      }
    }
  }

  /**
   * Algorithme DLA avec symétrie axiale.
   */
  generateDLASymmetry(dungeon, params) {
    const particles = params.particles ?? 200;
    const radius = params.radius ?? 5;
    const spawnRadius = params.spawnRadius ?? Math.max(dungeon.width, dungeon.height) / 2;
    const maxAttempts = params.maxAttempts ?? 1000;
    const symmetry = params.symmetry ?? 'both'; // 'none', 'x', 'y', 'both'

    const solLayer = dungeon.getLayer('sol');
    const murLayer = dungeon.getLayer('murs');
    solLayer.tiles = [];
    murLayer.tiles = [];

    const w = dungeon.width;
    const h = dungeon.height;
    const centerX = Math.floor(w / 2);
    const centerY = Math.floor(h / 2);

    const occupied = Array(h).fill().map(() => Array(w).fill(false));

    function getSymmetricPositions(x, y) {
      const positions = [];
      positions.push([x, y]);
      if (symmetry === 'x' || symmetry === 'both') {
        positions.push([w - 1 - x, y]);
      }
      if (symmetry === 'y' || symmetry === 'both') {
        positions.push([x, h - 1 - y]);
      }
      if (symmetry === 'both') {
        positions.push([w - 1 - x, h - 1 - y]);
      }
      return positions;
    }

    function setOccupiedWithSymmetry(x, y) {
      const positions = getSymmetricPositions(x, y);
      let placed = false;
      for (const [px, py] of positions) {
        if (px >= 0 && px < w && py >= 0 && py < h && !occupied[py][px]) {
          occupied[py][px] = true;
          solLayer.tiles.push({ type: 'sol', x: px, y: py });
          placed = true;
        }
      }
      return placed;
    }

    function isAdjacentToOccupied(x, y) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && occupied[ny][nx]) {
            return true;
          }
        }
      }
      return false;
    }

    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (x*x + y*y <= radius*radius) {
          const px = centerX + x;
          const py = centerY + y;
          if (px >= 0 && px < w && py >= 0 && py < h) {
            setOccupiedWithSymmetry(px, py);
          }
        }
      }
    }

    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];

    for (let p = 0; p < particles; p++) {
      let placed = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const angle = Math.random() * 2 * Math.PI;
        const dist = Math.floor(Math.random() * spawnRadius) + 1;
        let x = centerX + Math.floor(Math.cos(angle) * dist);
        let y = centerY + Math.floor(Math.sin(angle) * dist);
        if (x < 0 || x >= w || y < 0 || y >= h) continue;

        let walkSteps = 0;
        while (walkSteps < 1000) {
          if (isAdjacentToOccupied(x, y)) {
            if (setOccupiedWithSymmetry(x, y)) {
              placed = true;
            }
            break;
          }
          const dir = Math.floor(Math.random() * 4);
          const nx = x + dirs[dir][0];
          const ny = y + dirs[dir][1];
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            x = nx;
            y = ny;
          }
          walkSteps++;
        }
        if (placed) break;
      }
    }
  }

  // --------------------------------------------------------------
  // 6. Algorithme Graph Grammar avancé
  // --------------------------------------------------------------

  /**
   * Algorithme Graph Grammar : réécriture de graphe.
   * Applique des règles de transformation pour générer un donjon.
   * Supporte : couloirs larges, portes, symétries, hiérarchies.
   */
  generateGraphGrammar(dungeon, params) {
    const iterations = params.iterations ?? 5;
    const spacing = params.spacing ?? 3;
    const maxNodes = params.maxNodes ?? 200;
    const startType = params.startType ?? 'sol';

    // Règles par défaut (si non fournies)
    const defaultRules = this.getAdvancedGrammarRules();
    const rules = params.rules ?? defaultRules;

    const solLayer = dungeon.getLayer('sol');
    const murLayer = dungeon.getLayer('murs');
    const objLayer = dungeon.getLayer('objets');
    // Récupérer ou créer le calque couloirs
    let corridorLayer = dungeon.getLayer('couloirs');
    if (!corridorLayer) {
      corridorLayer = dungeon.addLayer('couloirs', true);
    }
    solLayer.tiles = [];
    murLayer.tiles = [];
    objLayer.tiles = [];
    corridorLayer.tiles = [];

    const w = dungeon.width;
    const h = dungeon.height;
    const centerX = Math.floor(w / 2);
    const centerY = Math.floor(h / 2);

    // Représentation du graphe
    const graph = [];
    let nextId = 0;

    function createNode(x, y, type, level = 0) {
      const node = { id: nextId++, x, y, type, level, children: [] };
      graph.push(node);
      return node;
    }

    function isPositionFree(x, y) {
      for (const node of graph) {
        const dx = node.x - x;
        const dy = node.y - y;
        if (Math.abs(dx) < spacing && Math.abs(dy) < spacing) return false;
      }
      return true;
    }

    function findFreeDirection(node) {
      const dirs = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1]
      ];
      for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
      }
      for (const [dx, dy] of dirs) {
        const nx = node.x + dx * spacing;
        const ny = node.y + dy * spacing;
        if (nx >= 1 && nx < w - 1 && ny >= 1 && ny < h - 1 && isPositionFree(nx, ny)) {
          return { x: nx, y: ny };
        }
      }
      return null;
    }

    // Fonction pour ajouter un couloir entre deux nœuds avec type et propriétés
    function addCorridor(nodeA, nodeB, type = 'standard', props = {}) {
      // type: 'standard', 'large', 'door', 'secret'
      // props: { width, hasDoor, doorInterval, secretPassage }
      const x1 = nodeA.x, y1 = nodeA.y;
      const x2 = nodeB.x, y2 = nodeB.y;
      // On trace un couloir en L
      let x = x1, y = y1;
      // D'abord horizontalement
      while (x !== x2) {
        const step = x < x2 ? 1 : -1;
        x += step;
        // Ajouter du sol
        solLayer.tiles = solLayer.tiles.filter(t => !(t.x === x && t.y === y));
        solLayer.tiles.push({ type: 'sol', x, y });
        murLayer.tiles = murLayer.tiles.filter(t => !(t.x === x && t.y === y));
        // Si large, on élargit
        if (type === 'large' && props.width) {
          const half = Math.floor((props.width - 1) / 2);
          for (let dy = -half; dy <= half; dy++) {
            if (dy === 0) continue;
            const ny = y + dy;
            if (ny >= 0 && ny < h) {
              solLayer.tiles = solLayer.tiles.filter(t => !(t.x === x && t.y === ny));
              solLayer.tiles.push({ type: 'sol', x, y: ny });
              murLayer.tiles = murLayer.tiles.filter(t => !(t.x === x && t.y === ny));
            }
          }
        }
        // Si porte, placer une porte à mi-chemin (uniquement si on a parcouru la moitié)
        if (type === 'door' && props.hasDoor) {
          // On place une porte sur une tuile du couloir (par exemple au milieu)
          const midX = Math.floor((x1 + x2) / 2);
          const midY = Math.floor((y1 + y2) / 2);
          if (x === midX && y === midY) {
            solLayer.tiles = solLayer.tiles.filter(t => !(t.x === x && t.y === y));
            solLayer.tiles.push({ type: 'porte', x, y });
          }
        }
        // Métadonnées du couloir (pour le rendu)
        corridorLayer.tiles.push({ type: 'corridor', x, y, corridorType: type, ...props });
      }
      // Ensuite verticalement
      while (y !== y2) {
        const step = y < y2 ? 1 : -1;
        y += step;
        solLayer.tiles = solLayer.tiles.filter(t => !(t.x === x && t.y === y));
        solLayer.tiles.push({ type: 'sol', x, y });
        murLayer.tiles = murLayer.tiles.filter(t => !(t.x === x && t.y === y));
        if (type === 'large' && props.width) {
          const half = Math.floor((props.width - 1) / 2);
          for (let dx = -half; dx <= half; dx++) {
            if (dx === 0) continue;
            const nx = x + dx;
            if (nx >= 0 && nx < w) {
              solLayer.tiles = solLayer.tiles.filter(t => !(t.x === nx && t.y === y));
              solLayer.tiles.push({ type: 'sol', x: nx, y });
              murLayer.tiles = murLayer.tiles.filter(t => !(t.x === nx && t.y === y));
            }
          }
        }
        if (type === 'door' && props.hasDoor) {
          const midX = Math.floor((x1 + x2) / 2);
          const midY = Math.floor((y1 + y2) / 2);
          if (x === midX && y === midY) {
            solLayer.tiles = solLayer.tiles.filter(t => !(t.x === x && t.y === y));
            solLayer.tiles.push({ type: 'porte', x, y });
          }
        }
        corridorLayer.tiles.push({ type: 'corridor', x, y, corridorType: type, ...props });
      }
    }

    // Fonction pour ajouter des symétriques d'un nœud
    function addSymmetrical(node, axis = 'both') {
      const positions = [];
      const symX = w - 1 - node.x;
      const symY = h - 1 - node.y;
      if (axis === 'x' || axis === 'both') {
        positions.push({ x: symX, y: node.y });
      }
      if (axis === 'y' || axis === 'both') {
        positions.push({ x: node.x, y: symY });
      }
      if (axis === 'both') {
        positions.push({ x: symX, y: symY });
      }
      const added = [];
      for (const pos of positions) {
        if (isPositionFree(pos.x, pos.y)) {
          const newNode = createNode(pos.x, pos.y, node.type, node.level);
          // Relier par un couloir large
          addCorridor(node, newNode, 'large', { width: 3 });
          added.push(newNode);
        }
      }
      return added;
    }

    // Créer le nœud racine
    const root = createNode(centerX, centerY, startType, 0);

    // Appliquer les règles itérativement
    for (let iter = 0; iter < iterations; iter++) {
      if (graph.length >= maxNodes) break;
      // Sélectionner un nœud aléatoire
      const node = graph[Math.floor(Math.random() * graph.length)];
      // Sélectionner une règle aléatoire
      const rule = rules[Math.floor(Math.random() * rules.length)];
      // Contexte pour les règles
      const ctx = {
        node,
        graph,
        createNode,
        findFreeDirection,
        isPositionFree,
        dungeon,
        solLayer,
        murLayer,
        corridorLayer,
        objLayer,
        spacing,
        w, h,
        addCorridor,
        addSymmetrical,
        centerX,
        centerY
      };
      rule(ctx);
    }

    // Après génération, transformer les nœuds en tuiles (sauf si déjà fait dans les règles)
    // Certaines règles ajoutent directement des tuiles, mais on ajoute les nœuds restants
    // On s'assure que tous les nœuds ont une tuile sol
    for (const node of graph) {
      // Vérifier si une tuile sol existe déjà à cette position
      const already = solLayer.tiles.some(t => t.x === node.x && t.y === node.y);
      if (!already) {
        solLayer.tiles.push({ type: node.type, x: node.x, y: node.y });
      }
    }
  }

  /**
   * Règles de grammaire avancées (avec couloirs, symétries, hiérarchies).
   * Retourne un tableau de fonctions.
   */
  getAdvancedGrammarRules() {
    const rules = [];

    // Règle 1 : Enfilade simple - ajouter une salle en ligne droite
    rules.push((ctx) => {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const nx = ctx.node.x + dir[0] * ctx.spacing;
      const ny = ctx.node.y + dir[1] * ctx.spacing;
      if (ctx.isPositionFree(nx, ny) && nx > 0 && nx < ctx.w && ny > 0 && ny < ctx.h) {
        const newNode = ctx.createNode(nx, ny, 'sol', ctx.node.level);
        ctx.addCorridor(ctx.node, newNode, 'standard');
      }
    });

    // Règle 2 : Enfilade symétrique (miroir) - ajoute une salle et son symétrique
    rules.push((ctx) => {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const nx = ctx.node.x + dir[0] * ctx.spacing;
      const ny = ctx.node.y + dir[1] * ctx.spacing;
      if (ctx.isPositionFree(nx, ny) && nx > 0 && nx < ctx.w && ny > 0 && ny < ctx.h) {
        const newNode = ctx.createNode(nx, ny, 'sol', ctx.node.level);
        ctx.addCorridor(ctx.node, newNode, 'standard');
        // Symétrie par rapport à l'axe Y (vertical)
        const symX = ctx.w - 1 - nx;
        const symY = ny;
        if (ctx.isPositionFree(symX, symY)) {
          const symNode = ctx.createNode(symX, symY, 'sol', ctx.node.level);
          ctx.addCorridor(ctx.node, symNode, 'standard');
          // Relier les deux symétriques entre eux ?
          ctx.addCorridor(newNode, symNode, 'large', { width: 3 });
        }
      }
    });

    // Règle 3 : Arbre binaire - ajouter jusqu'à 2 enfants
    rules.push((ctx) => {
      const childrenCount = Math.floor(Math.random() * 2) + 1; // 1 ou 2
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      // Mélanger les directions
      for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
      }
      let added = 0;
      for (const dir of dirs) {
        if (added >= childrenCount) break;
        const nx = ctx.node.x + dir[0] * ctx.spacing;
        const ny = ctx.node.y + dir[1] * ctx.spacing;
        if (ctx.isPositionFree(nx, ny) && nx > 0 && nx < ctx.w && ny > 0 && ny < ctx.h) {
          const child = ctx.createNode(nx, ny, 'sol', ctx.node.level + 1);
          ctx.addCorridor(ctx.node, child, 'standard');
          added++;
        }
      }
    });

    // Règle 4 : Symétrie rotationnelle (90°)
    rules.push((ctx) => {
      const angle = 90; // degrés
      const radians = angle * Math.PI / 180;
      const cx = ctx.w / 2;
      const cy = ctx.h / 2;
      const dx = ctx.node.x - cx;
      const dy = ctx.node.y - cy;
      const rx = dx * Math.cos(radians) - dy * Math.sin(radians);
      const ry = dx * Math.sin(radians) + dy * Math.cos(radians);
      const nx = Math.round(cx + rx);
      const ny = Math.round(cy + ry);
      if (nx >= 0 && nx < ctx.w && ny >= 0 && ny < ctx.h && ctx.isPositionFree(nx, ny)) {
        const newNode = ctx.createNode(nx, ny, ctx.node.type, ctx.node.level);
        ctx.addCorridor(ctx.node, newNode, 'large', { width: 3 });
      }
    });

    // Règle 5 : Couloir large
    rules.push((ctx) => {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const nx = ctx.node.x + dir[0] * ctx.spacing;
      const ny = ctx.node.y + dir[1] * ctx.spacing;
      if (ctx.isPositionFree(nx, ny) && nx > 0 && nx < ctx.w && ny > 0 && ny < ctx.h) {
        const newNode = ctx.createNode(nx, ny, 'sol', ctx.node.level);
        ctx.addCorridor(ctx.node, newNode, 'large', { width: 3 });
      }
    });

    // Règle 6 : Couloir avec porte
    rules.push((ctx) => {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const nx = ctx.node.x + dir[0] * ctx.spacing;
      const ny = ctx.node.y + dir[1] * ctx.spacing;
      if (ctx.isPositionFree(nx, ny) && nx > 0 && nx < ctx.w && ny > 0 && ny < ctx.h) {
        const newNode = ctx.createNode(nx, ny, 'sol', ctx.node.level);
        ctx.addCorridor(ctx.node, newNode, 'door', { hasDoor: true });
      }
    });

    // Règle 7 : Hiérarchique - ajouter des salles de niveaux différents
    rules.push((ctx) => {
      const level = ctx.node.level || 0;
      if (level < 2) {
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const nx = ctx.node.x + dir[0] * ctx.spacing;
        const ny = ctx.node.y + dir[1] * ctx.spacing;
        if (ctx.isPositionFree(nx, ny) && nx > 0 && nx < ctx.w && ny > 0 && ny < ctx.h) {
          const newNode = ctx.createNode(nx, ny, 'sol', level + 1);
          ctx.addCorridor(ctx.node, newNode, 'standard');
        }
      }
    });

    // Règle 8 : Ajouter une salle de trésor
    rules.push((ctx) => {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const nx = ctx.node.x + dir[0] * ctx.spacing;
      const ny = ctx.node.y + dir[1] * ctx.spacing;
      if (ctx.isPositionFree(nx, ny) && nx > 0 && nx < ctx.w && ny > 0 && ny < ctx.h) {
        const newNode = ctx.createNode(nx, ny, 'trésor', ctx.node.level);
        ctx.addCorridor(ctx.node, newNode, 'door', { hasDoor: true });
      }
    });

    // Règle 9 : Symétrie axiale totale (miroir des deux axes)
    rules.push((ctx) => {
      const symNodes = ctx.addSymmetrical(ctx.node, 'both');
      // On peut ajouter un couloir central entre les symétriques
      if (symNodes.length > 0) {
        for (const sym of symNodes) {
          ctx.addCorridor(ctx.node, sym, 'large', { width: 3 });
        }
      }
    });

    return rules;
  }

  /**
   * Règles de grammaire par défaut (simples) pour compatibilité.
   */
  getDefaultGrammarRules() {
    const rules = [];
    rules.push((ctx) => {
      const pos = ctx.findFreeDirection(ctx.node);
      if (pos) {
        ctx.createNode(pos.x, pos.y, 'sol', ctx.node.level || 0);
      }
    });
    return rules;
  }

  // --------------------------------------------------------------
  // 7. Outils communs
  // --------------------------------------------------------------

  corridorBetween(x1, y1, x2, y2, solLayer, murLayer) {
    let x = x1, y = y1;
    while (x !== x2) {
      const step = x < x2 ? 1 : -1;
      x += step;
      solLayer.tiles = solLayer.tiles.filter(t => !(t.x === x && t.y === y));
      solLayer.tiles.push({ type: 'sol', x, y });
      murLayer.tiles = murLayer.tiles.filter(t => !(t.x === x && t.y === y));
    }
    while (y !== y2) {
      const step = y < y2 ? 1 : -1;
      y += step;
      solLayer.tiles = solLayer.tiles.filter(t => !(t.x === x && t.y === y));
      solLayer.tiles.push({ type: 'sol', x, y });
      murLayer.tiles = murLayer.tiles.filter(t => !(t.x === x && t.y === y));
    }
  }

  placeWalls() {
    const solLayer = this.getLayer('sol');
    const murLayer = this.getLayer('murs');
    const isSol = (x, y) => solLayer.tiles.some(t => t.type === 'sol' && t.x === x && t.y === y);
    const solTiles = solLayer.tiles.filter(t => t.type === 'sol');
    for (const tile of solTiles) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = tile.x + dx, ny = tile.y + dy;
          if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
          if (!isSol(nx, ny)) {
            const already = murLayer.tiles.some(t => t.x === nx && t.y === ny);
            if (!already) {
              murLayer.tiles.push({ type: 'mur', x: nx, y: ny });
            }
          }
        }
      }
    }
  }

  cleanWalls() {
    const solLayer = this.getLayer('sol');
    const murLayer = this.getLayer('murs');
    const isSol = (x, y) => solLayer.tiles.some(t => t.type === 'sol' && t.x === x && t.y === y);
    murLayer.tiles = murLayer.tiles.filter(t => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = t.x + dx, ny = t.y + dy;
          if (isSol(nx, ny)) return true;
        }
      }
      return false;
    });
  }

  // --------------------------------------------------------------
  // 8. Réinitialisation
  // --------------------------------------------------------------

  clearAll(clearAnnotations = true) {
    for (const layer of this.layers) {
      layer.tiles = [];
    }
    if (clearAnnotations) {
      this.annotations = [];
    } else {
      const annLayer = this.getLayer('annotations');
      if (annLayer) annLayer.tiles = [];
      for (const ann of this.annotations) {
        annLayer.tiles.push({ type: 'annotation', x: ann.x, y: ann.y, text: ann.text, color: ann.color, fontSize: ann.fontSize });
      }
    }
    this.pushHistory();
    this.render();
  }

  // --------------------------------------------------------------
  // 9. Rendu SVG
  // --------------------------------------------------------------

  initSVG() {
    if (this.svg) this.svg.remove();
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('width', this.width * this.tileSize);
    this.svg.setAttribute('height', this.height * this.tileSize);
    this.svg.style.border = '1px solid #ccc';
    this.svg.style.backgroundColor = '#f0ece6';
    this.container.appendChild(this.svg);
  }

  render() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', '#f0ece6');
    this.svg.appendChild(bg);

    for (const layer of this.layers) {
      if (!layer.visible) continue;
      for (const tile of layer.tiles) {
        this.drawTile(tile, layer.name);
      }
    }

    if (this.scaleBar.visible) {
      this.drawScaleBar();
    }
  }

  drawTile(tile, layerName) {
    const typeDef = this.tileRegistry[tile.type];
    if (!typeDef) {
      // Si le type n'est pas trouvé, on ignore
      return;
    }
    const x = tile.x * this.tileSize;
    const y = tile.y * this.tileSize;

    // Pour le calque couloirs, on peut dessiner des bordures ou des symboles
    if (layerName === 'couloirs') {
      // On ne dessine pas de rectangle, mais on peut ajouter un petit indicateur
      // Par exemple, si corridorType === 'door', dessiner un symbole
      if (tile.corridorType === 'door') {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + this.tileSize/2);
        text.setAttribute('y', y + this.tileSize/2);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('font-size', this.tileSize * 0.5);
        text.setAttribute('fill', '#8b5a2b');
        text.textContent = '🚪';
        this.svg.appendChild(text);
      }
      return;
    }

    // Pour les autres calques
    if (typeDef.color !== 'transparent') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', this.tileSize);
      rect.setAttribute('height', this.tileSize);
      rect.setAttribute('fill', typeDef.color);
      rect.setAttribute('stroke', '#333');
      rect.setAttribute('stroke-width', '0.5');
      if (tile.rotation) {
        rect.setAttribute('transform', `rotate(${tile.rotation}, ${x + this.tileSize/2}, ${y + this.tileSize/2})`);
      }
      this.svg.appendChild(rect);
    }

    if (typeDef.icon) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x + this.tileSize/2);
      text.setAttribute('y', y + this.tileSize/2);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-size', this.tileSize * 0.7);
      text.textContent = typeDef.icon;
      this.svg.appendChild(text);
    }

    if (tile.text) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x + this.tileSize/2);
      text.setAttribute('y', y + this.tileSize/2);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-size', tile.fontSize || 12);
      text.setAttribute('fill', tile.color || '#000');
      text.textContent = tile.text;
      this.svg.appendChild(text);
    }
  }

  drawScaleBar() {
    const barX = this.width * this.tileSize - 100;
    const barY = this.height * this.tileSize - 30;
    const width = 80;
    const height = 6;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', barX);
    rect.setAttribute('y', barY);
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
    rect.setAttribute('fill', '#333');
    this.svg.appendChild(rect);

    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', barX);
    line1.setAttribute('y1', barY - 5);
    line1.setAttribute('x2', barX);
    line1.setAttribute('y2', barY + height + 5);
    line1.setAttribute('stroke', '#333');
    line1.setAttribute('stroke-width', '2');
    this.svg.appendChild(line1);

    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', barX + width);
    line2.setAttribute('y1', barY - 5);
    line2.setAttribute('x2', barX + width);
    line2.setAttribute('y2', barY + height + 5);
    line2.setAttribute('stroke', '#333');
    line2.setAttribute('stroke-width', '2');
    this.svg.appendChild(line2);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', barX + width/2);
    label.setAttribute('y', barY - 8);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '12');
    label.setAttribute('fill', '#333');
    const distance = (width / this.scaleBar.pixelsPerUnit).toFixed(1);
    label.textContent = `${distance} ${this.scaleBar.unit}`;
    this.svg.appendChild(label);
  }

  // --------------------------------------------------------------
  // 10. Historique (Undo/Redo)
  // --------------------------------------------------------------

  pushHistory() {
    const state = this.layers.map(layer => ({
      name: layer.name,
      visible: layer.visible,
      tiles: layer.tiles.map(t => ({ ...t }))
    }));
    state.annotations = this.annotations.map(a => ({ ...a }));
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(state);
    this.historyIndex = this.history.length - 1;
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restoreState(this.history[this.historyIndex]);
      this.render();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restoreState(this.history[this.historyIndex]);
      this.render();
    }
  }

  restoreState(state) {
    for (const layerState of state) {
      const layer = this.getLayer(layerState.name);
      if (layer) {
        layer.visible = layerState.visible;
        layer.tiles = layerState.tiles.map(t => ({ ...t }));
      }
    }
    this.annotations = state.annotations ? state.annotations.map(a => ({ ...a })) : [];
    const annLayer = this.getLayer('annotations');
    if (annLayer) {
      annLayer.tiles = this.annotations.map(a => ({
        type: 'annotation',
        x: a.x, y: a.y,
        text: a.text,
        color: a.color,
        fontSize: a.fontSize
      }));
    }
  }

  // --------------------------------------------------------------
  // 11. Export et Impression
  // --------------------------------------------------------------

  exportSVG(filename = 'donjon.svg') {
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(this.svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  exportPNG(filename = 'donjon.png') {
    const canvas = document.createElement('canvas');
    canvas.width = this.width * this.tileSize;
    canvas.height = this.height * this.tileSize;
    const ctx = canvas.getContext('2d');
    const svgData = new XMLSerializer().serializeToString(this.svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = filename;
      link.click();
    };
    img.src = url;
  }

  print() {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    printWindow.document.write(`
      <html>
        <head><title>Donjon</title>
        <style>
          body { margin:0; display:flex; justify-content:center; align-items:center; height:100vh; }
          svg { max-width:100%; max-height:100%; }
        </style>
        </head>
        <body>
          ${this.svg.outerHTML}
          <script>
            window.onload = function() { window.print(); }
          <\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
}

export { DungeonGenerator };
