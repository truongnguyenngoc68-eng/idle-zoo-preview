import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// ============================================================================
// PATH CONSTANTS (Served from /kaykit -> D:\game\references\kaykit)
// ============================================================================
const DUNGEON_PATH = '/kaykit/kaykit-dungeon-remastered/KayKit_Dungeon_Pack_1.1_FREE/Assets/gltf/';
const ADV_CHAR_PATH = '/kaykit/kaykit-adventurers/KayKit_Adventurers_2.0_FREE/Characters/gltf/';
const ADV_ITEM_PATH = '/kaykit/kaykit-adventurers/KayKit_Adventurers_2.0_FREE/Assets/gltf/';
const SKEL_CHAR_PATH = '/kaykit/kaykit-skeletons/KayKit_Skeletons_1.1_FREE/characters/gltf/';
const SKEL_ITEM_PATH = '/kaykit/kaykit-skeletons/KayKit_Skeletons_1.1_FREE/Assets/gltf/';
const ANIM_MED_PATH = '/kaykit/kaykit-character-animations/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/';
const PET_PATH = '/kaykit/companion-pets-quaternius/';

const RIG_MEDIUM_PACKS = [
  'Rig_Medium_MovementBasic.glb',
  'Rig_Medium_MovementAdvanced.glb',
  'Rig_Medium_CombatMelee.glb',
  'Rig_Medium_CombatRanged.glb',
  'Rig_Medium_General.glb',
  'Rig_Medium_Special.glb',
  'Rig_Medium_Simulation.glb',
  'Rig_Medium_Tools.glb',
];

// ============================================================================
// SCENE, CAMERA & RENDERER SETUP
// ============================================================================
const container = document.getElementById('canvas-container')!;
const worldLabelsContainer = document.getElementById('world-labels')!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c101c);
scene.fog = new THREE.FogExp2(0x0c101c, 0.0085);

const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.5, 180);
let cameraMode: 'combat' | 'overview' | 'closeup' = 'combat';
let cameraZoom = 1.0;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

// ============================================================================
// LIGHTING SETUP (Moonlight Directional + Hemisphere + Warm Torch PointLights)
// ============================================================================
const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x291d18, 0.95);
hemiLight.position.set(0, 28, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xe0f2fe, 1.75);
dirLight.position.set(18, 36, 22);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 2;
dirLight.shadow.camera.far = 95;
const d = 30;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

// Dedicated spotlight on the North Elevated Chest Dais
const daisSpot = new THREE.SpotLight(0xfbbf24, 5.5, 26, Math.PI / 4, 0.5, 1.2);
daisSpot.position.set(0, 10.5, -13.5);
daisSpot.target.position.set(0, 1.5, -18.5);
scene.add(daisSpot);
scene.add(daisSpot.target);

interface TorchLightInfo {
  light: THREE.PointLight;
  flameMesh: THREE.Mesh;
  baseIntensity: number;
  phase: number;
}
const torchLights: TorchLightInfo[] = [];

// ============================================================================
// ASSET CACHE & LOADER HELPERS
// ============================================================================
const gltfLoader = new GLTFLoader();
const modelCache = new Map<string, GLTF>();
const masterClips = new Map<string, THREE.AnimationClip>();

function setLoadingText(msg: string) {
  const el = document.getElementById('loading-progress-text');
  if (el) el.textContent = msg;
}

async function loadGltf(url: string): Promise<GLTF> {
  if (modelCache.has(url)) return modelCache.get(url)!;
  const gltf = await gltfLoader.loadAsync(url);
  gltf.scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  modelCache.set(url, gltf);
  return gltf;
}

function sanitizeInPlaceClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  // Keep vertical bounce on hips, remove horizontal X/Z root drift on locomotion clips
  const isLocomotion =
    clip.name.includes('Running') ||
    clip.name.includes('Walking') ||
    clip.name.includes('Dodge') ||
    clip.name.includes('Gallop') ||
    clip.name.includes('Walk');
  if (!isLocomotion) return clip;

  const cloned = clip.clone();
  for (const track of cloned.tracks) {
    if (
      track.name.endsWith('.position') &&
      (track.name.startsWith('root.') ||
        track.name.startsWith('hips.') ||
        track.name.startsWith('Body.'))
    ) {
      const values = track.values;
      const baseX = values[0];
      const baseZ = values[2];
      for (let i = 0; i < values.length; i += 3) {
        values[i] = baseX;
        values[i + 2] = baseZ;
      }
    }
  }
  return cloned;
}

function findBoneSlot(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (!found && names.includes(obj.name)) {
      found = obj;
    }
  });
  return found;
}

// ============================================================================
// FLOOR HEIGHT FUNCTION (Includes Large Elevated North Sanctuary & 3 Staircases)
// ============================================================================
const DAIS_HEIGHT = 1.45;
function getFloorHeight(x: number, z: number): number {
  // North Elevated Sanctuary: Z from -13.2 to -23.5, X from -14.5 to +14.5
  if (z <= -13.2 && Math.abs(x) <= 14.5) {
    return DAIS_HEIGHT;
  }
  // Central Wide Stairs (X in [-3.4, 3.4]) & Left/Right Side Stairs (X in [-10.8, -7.2] and [7.2, 10.8])
  const onCenterStairs = Math.abs(x) <= 3.4;
  const onSideStairs = Math.abs(x) >= 7.0 && Math.abs(x) <= 11.0;
  if (z < -10.0 && z > -13.2 && (onCenterStairs || onSideStairs)) {
    const t = (-10.0 - z) / (-10.0 - -13.2);
    return THREE.MathUtils.clamp(t, 0, 1) * DAIS_HEIGHT;
  }
  return 0;
}

// ============================================================================
// BUILD EXPANDED 5-ZONE 3D DUNGEON COMPLEX (56m x 56m — KayKit Dungeon Pack 1.1)
// ============================================================================
let rewardChestGroup: THREE.Object3D | null = null;
let rewardChestLid: THREE.Object3D | null = null;
let rewardChestRing: THREE.Mesh | null = null;
let chestState: 'locked' | 'unlocked' | 'opening' | 'opened' = 'locked';
let chestOpenProgress = 0;

async function buildDungeonRoom() {
  setLoadingText('Đang dựng Đại Hầm Ngục 5 Khu Vực (56m × 56m), cầu thang, sảnh tiệc, kho vũ khí...');
  const propFiles = [
    'floor_tile_large.gltf',
    'floor_tile_large_rocks.gltf',
    'floor_tile_grate_open.gltf',
    'floor_tile_small_decorated.gltf',
    'floor_foundation_allsides.gltf',
    'wall.gltf',
    'wall_arched.gltf',
    'wall_archedwindow_gated.gltf',
    'wall_doorway.gltf',
    'wall_shelves.gltf',
    'wall_corner.gltf',
    'pillar_decorated.gltf',
    'pillar.gltf',
    'stairs_wide.gltf',
    'stairs.gltf',
    'chest_gold.gltf',
    'chest.gltf',
    'torch_lit.gltf',
    'torch_mounted.gltf',
    'banner_patternA_red.gltf',
    'banner_patternB_blue.gltf',
    'banner_shield_blue.gltf',
    'banner_triple_yellow.gltf',
    'barrel_large_decorated.gltf',
    'barrel_small_stack.gltf',
    'crates_stacked.gltf',
    'table_long_decorated_A.gltf',
    'table_long_tablecloth_decorated_A.gltf',
    'bed_decorated.gltf',
    'shelves.gltf',
    'rubble_large.gltf',
    'chair.gltf',
    'stool.gltf',
    'shelf_small_candles.gltf',
    'keg_decorated.gltf',
    'coin_stack_large.gltf',
    'sword_shield_gold.gltf',
  ];

  await Promise.all(propFiles.map((f) => loadGltf(DUNGEON_PATH + f)));

  const roomGroup = new THREE.Group();
  roomGroup.name = 'DungeonRoom';
  scene.add(roomGroup);

  const placeProp = (
    file: string,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    scaleX = 1,
    scaleY = 1,
    scaleZ = 1
  ): THREE.Object3D => {
    const gltf = modelCache.get(DUNGEON_PATH + file)!;
    const clone = gltf.scene.clone(true);
    clone.position.set(x, y, z);
    clone.rotation.y = rotY;
    clone.scale.set(scaleX, scaleY, scaleZ);
    roomGroup.add(clone);
    return clone;
  };

  // 1. Huge Tiled Dungeon Floor (13x13 grid of 4m x 4m tiles -> 52m x 52m floor!)
  for (let gx = -24; gx <= 24; gx += 4) {
    for (let gz = -24; gz <= 24; gz += 4) {
      const isCenterGrate = (gx === -4 || gx === 4) && (gz === 0 || gz === 8);
      const isRockyBorder = Math.abs(gx) >= 20 || gz >= 20;
      const tileFile = isCenterGrate
        ? 'floor_tile_grate_open.gltf'
        : isRockyBorder
          ? 'floor_tile_large_rocks.gltf'
          : 'floor_tile_large.gltf';
      placeProp(tileFile, gx, 0, gz, 0);
    }
  }

  // Grand Arena floor rune rings (Center & South)
  for (const [rx, rz, rSize, rColor] of [
    [0, 2, 5.8, 0x38bdf8],
    [-18, 2, 3.4, 0xf59e0b],
    [18, 2, 3.4, 0xa855f7],
    [0, 16, 4.2, 0x10b981],
  ] as [number, number, number, number][]) {
    const ringGeo = new THREE.RingGeometry(rSize - 0.25, rSize, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: rColor,
      transparent: true,
      opacity: 0.22,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(rx, 0.06, rz);
    roomGroup.add(ring);
  }

  // 2. ZONE 1: Elevated North Sanctuary (X in [-14, 14], Z in [-22, -13.2], height = DAIS_HEIGHT)
  for (let fx = -13; fx <= 13; fx += 2) {
    for (let fz = -21.5; fz <= -13.5; fz += 2) {
      placeProp('floor_foundation_allsides.gltf', fx, DAIS_HEIGHT - 2.0, fz, 0);
    }
  }
  for (let tx = -12; tx <= 12; tx += 4) {
    for (let tz = -20; tz <= -16; tz += 4) {
      placeProp('floor_tile_large.gltf', tx, DAIS_HEIGHT, tz, 0);
    }
  }

  // 3 Staircases leading up to the North Sanctuary (1 Wide Center + 2 Side Stairs)
  placeProp('stairs_wide.gltf', 0, 0, -13.2, 0, 0.95, DAIS_HEIGHT / 4.9, 0.8);
  placeProp('stairs.gltf', -9.0, 0, -13.2, 0, 0.85, DAIS_HEIGHT / 4.9, 0.8);
  placeProp('stairs.gltf', 9.0, 0, -13.2, 0, 0.85, DAIS_HEIGHT / 4.9, 0.8);

  // 3. Outer Perimeter Walls (North at Z = -24.5, West at X = -24.8, East at X = +24.8, South at Z = +24.8)
  for (let wx = -24; wx <= 24; wx += 4) {
    const yBase = Math.abs(wx) <= 12 ? DAIS_HEIGHT : 0;
    const file =
      wx === 0
        ? 'wall_doorway.gltf'
        : Math.abs(wx) === 8 || Math.abs(wx) === 16
          ? 'wall_archedwindow_gated.gltf'
          : 'wall_arched.gltf';
    placeProp(file, wx, yBase, -24.5, 0);
  }

  for (let wz = -20; wz <= 20; wz += 4) {
    const leftFile =
      wz % 8 === 0 ? 'wall_shelves.gltf' : wz % 12 === 0 ? 'wall_archedwindow_gated.gltf' : 'wall.gltf';
    const rightFile =
      wz % 8 === 0 ? 'wall_arched.gltf' : wz % 12 === 0 ? 'wall_shelves.gltf' : 'wall.gltf';
    placeProp(leftFile, -24.8, 0, wz, Math.PI / 2);
    placeProp(rightFile, 24.8, 0, wz, -Math.PI / 2);
  }

  // Open Arched Divider Colonnades between Central Arena and West/East Wings (at X = -12 and X = +12)
  for (const wz of [-8, 8, 16]) {
    placeProp('wall_arched.gltf', -12.0, 0, wz, Math.PI / 2);
    placeProp('wall_arched.gltf', 12.0, 0, wz, -Math.PI / 2);
  }

  // 4. Grand Columns & Banners across all 5 Zones
  const pillarCoords = [
    // North Sanctuary Pillars
    [-13.5, 0, -12.8],
    [-5.2, 0, -12.8],
    [5.2, 0, -12.8],
    [13.5, 0, -12.8],
    [-12.0, DAIS_HEIGHT, -22.5],
    [-5.2, DAIS_HEIGHT, -22.5],
    [5.2, DAIS_HEIGHT, -22.5],
    [12.0, DAIS_HEIGHT, -22.5],
    // Central Grand Hall Colonnade
    [-12.0, 0, -3.5],
    [12.0, 0, -3.5],
    [-12.0, 0, 3.5],
    [12.0, 0, 3.5],
    [-12.0, 0, 12.0],
    [12.0, 0, 12.0],
    // South Entrance Hall Pillars
    [-7.5, 0, 14.0],
    [7.5, 0, 14.0],
    [-7.5, 0, 21.5],
    [7.5, 0, 21.5],
  ];
  for (const [px, py, pz] of pillarCoords) {
    placeProp('pillar_decorated.gltf', px, py, pz, 0);
  }

  // Royal Banners on North Sanctuary & Side Walls
  for (const bx of [-8, -3, 3, 8]) {
    placeProp('banner_triple_yellow.gltf', bx, DAIS_HEIGHT + 0.3, -24.0, 0);
  }
  placeProp('sword_shield_gold.gltf', 0, DAIS_HEIGHT + 2.4, -24.1, 0);
  placeProp('banner_shield_blue.gltf', -12.0, DAIS_HEIGHT + 0.4, -21.9, 0);
  placeProp('banner_shield_blue.gltf', 12.0, DAIS_HEIGHT + 0.4, -21.9, 0);
  for (const bz of [-14, -2, 10]) {
    placeProp('banner_patternA_red.gltf', -24.1, 0.2, bz, Math.PI / 2);
    placeProp('banner_patternB_blue.gltf', 24.1, 0.2, bz, -Math.PI / 2);
  }

  // 5. ZONE 2 (WEST WING): Grand Banquet Hall & Wine Cellar (X in [-23, -14], Z in [-18, 16])
  placeProp('table_long_tablecloth_decorated_A.gltf', -18.5, 0, -4.0, 0);
  placeProp('table_long_decorated_A.gltf', -18.5, 0, 3.5, 0);
  placeProp('table_long_decorated_A.gltf', -18.5, 0, 11.0, 0);
  for (const cz of [-5.2, -2.8, 2.3, 4.7, 9.8, 12.2]) {
    placeProp('chair.gltf', -20.2, 0, cz, Math.PI / 2);
    placeProp('stool.gltf', -16.8, 0, cz, -Math.PI / 2);
  }
  placeProp('keg_decorated.gltf', -22.5, 0, -14.0, Math.PI / 3);
  placeProp('keg_decorated.gltf', -20.0, 0, -16.5, Math.PI / 6);
  placeProp('barrel_large_decorated.gltf', -22.5, 0, -10.5, 0);
  placeProp('shelf_small_candles.gltf', -23.2, 0, -18.5, Math.PI / 4);
  placeProp('chest.gltf', -18.5, 0, -18.0, 0, 1.05, 1.05, 1.05);

  // 6. ZONE 3 (EAST WING): Armory, Barracks & Supply Depot (X in [14, 23], Z in [-18, 16])
  placeProp('bed_decorated.gltf', 21.5, 0, -14.0, -Math.PI / 2);
  placeProp('bed_decorated.gltf', 21.5, 0, -9.0, -Math.PI / 2);
  placeProp('shelves.gltf', 23.2, 0, -3.5, -Math.PI / 2);
  placeProp('crates_stacked.gltf', 18.5, 0, 1.5, -0.4);
  placeProp('crates_stacked.gltf', 21.8, 0, 5.5, 0.25);
  placeProp('barrel_large_decorated.gltf', 22.2, 0, 9.5, 0);
  placeProp('barrel_small_stack.gltf', 18.2, 0, 11.5, -Math.PI / 2);
  placeProp('chest.gltf', 18.5, 0, -18.0, 0, 1.05, 1.05, 1.05);

  // 7. ZONE 4 (SOUTH COURTYARD): Ancient Rubble & Guard Posts (Z in [14, 22])
  placeProp('rubble_large.gltf', -15.5, 0, 19.5, 0.4);
  placeProp('rubble_large.gltf', 15.5, 0, 19.5, -0.6);
  placeProp('barrel_small_stack.gltf', -9.2, 0, 15.8, 0);
  placeProp('crates_stacked.gltf', 9.2, 0, 15.8, 0.3);

  // Gold coin piles flanking the North Sanctuary Chest
  placeProp('coin_stack_large.gltf', 3.2, DAIS_HEIGHT, -18.2, 0, 1.15, 1.15, 1.15);
  placeProp('coin_stack_large.gltf', -3.2, DAIS_HEIGHT, -18.2, 0.8, 1.15, 1.15, 1.15);

  // 8. Lit Torches with PointLights & Animated Flame Glows across the 56m x 56m Map
  const torchPositions: [number, number, number, number][] = [
    [-4.5, DAIS_HEIGHT + 1.5, -23.8, 0],
    [4.5, DAIS_HEIGHT + 1.5, -23.8, 0],
    [-5.2, 1.8, -12.0, 0],
    [5.2, 1.8, -12.0, 0],
    [-12.0, 1.8, -3.0, Math.PI / 2],
    [12.0, 1.8, -3.0, -Math.PI / 2],
    [-12.0, 1.8, 11.5, Math.PI / 2],
    [12.0, 1.8, 11.5, -Math.PI / 2],
    [-23.8, 1.9, -4.0, Math.PI / 2],
    [23.8, 1.9, -4.0, -Math.PI / 2],
    [-23.8, 1.9, 8.0, Math.PI / 2],
    [23.8, 1.9, 8.0, -Math.PI / 2],
    [-7.5, 1.8, 14.6, 0],
    [7.5, 1.8, 14.6, 0],
  ];

  const flameGeo = new THREE.SphereGeometry(0.18, 10, 10);
  for (let i = 0; i < torchPositions.length; i++) {
    const [tx, ty, tz, trot] = torchPositions[i];
    placeProp('torch_mounted.gltf', tx, ty, tz, trot, 1.15, 1.15, 1.15);
    placeProp('torch_lit.gltf', tx, ty, tz, trot, 1.15, 1.15, 1.15);

    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb703 });
    const flameMesh = new THREE.Mesh(flameGeo, flameMat);
    flameMesh.position.set(
      tx + Math.sin(trot) * 0.35,
      ty + 0.68,
      tz + Math.cos(trot) * 0.35
    );
    roomGroup.add(flameMesh);

    const pLight = new THREE.PointLight(0xff8c38, 4.2, 18, 1.35);
    pLight.position.copy(flameMesh.position).add(new THREE.Vector3(0, 0.25, 0));
    roomGroup.add(pLight);

    torchLights.push({
      light: pLight,
      flameMesh,
      baseIntensity: 4.2,
      phase: i * 1.17,
    });
  }

  // 9. Central Reward Chest (`chest_gold.gltf`) on the Elevated North Sanctuary
  rewardChestGroup = placeProp('chest_gold.gltf', 0, DAIS_HEIGHT, -18.5, 0, 1.25, 1.25, 1.25);
  rewardChestGroup.traverse((obj) => {
    if (obj.name.includes('lid')) {
      rewardChestLid = obj;
    }
  });

  const chestRingGeo = new THREE.RingGeometry(1.45, 1.8, 36);
  chestRingGeo.rotateX(-Math.PI / 2);
  const chestRingMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  });
  rewardChestRing = new THREE.Mesh(chestRingGeo, chestRingMat);
  rewardChestRing.position.set(0, DAIS_HEIGHT + 0.05, -18.5);
  roomGroup.add(rewardChestRing);
}

// ============================================================================
// FLOATING WORLD LABELS & DAMAGE POPUPS
// ============================================================================
interface HealthPlate {
  el: HTMLDivElement;
  fillEl: HTMLDivElement;
  nameEl: HTMLDivElement;
}

function createHealthPlate(name: string, kind: 'hero' | 'ally' | 'enemy'): HealthPlate {
  const el = document.createElement('div');
  el.className = 'unit-hp-plate';
  const nameEl = document.createElement('div');
  nameEl.className = 'unit-hp-name';
  nameEl.textContent = name;
  const barEl = document.createElement('div');
  barEl.className = 'unit-hp-bar';
  const fillEl = document.createElement('div');
  fillEl.className = `unit-hp-fill ${kind === 'ally' ? 'ally' : kind === 'hero' ? 'hero' : ''}`;
  fillEl.style.width = '100%';
  barEl.appendChild(fillEl);
  el.appendChild(nameEl);
  el.appendChild(barEl);
  worldLabelsContainer.appendChild(el);
  return { el, fillEl, nameEl };
}

function updateHealthPlatePosition(plate: HealthPlate, worldPos: THREE.Vector3, yOffset: number, visible = true) {
  if (!visible) {
    plate.el.style.display = 'none';
    return;
  }
  const v = worldPos.clone();
  v.y += yOffset;
  v.project(camera);
  if (v.z > 1) {
    plate.el.style.display = 'none';
    return;
  }
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  plate.el.style.display = 'flex';
  plate.el.style.left = `${x}px`;
  plate.el.style.top = `${y}px`;
}

function spawnDamagePopup(worldPos: THREE.Vector3, text: string, color = '#fde047') {
  const v = worldPos.clone();
  v.y += 1.9;
  v.project(camera);
  if (v.z > 1) return;
  const x = (v.x * 0.5 + 0.5) * window.innerWidth + (Math.random() - 0.5) * 26;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;

  const el = document.createElement('div');
  el.className = 'dmg-popup';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = color;
  el.textContent = text;
  worldLabelsContainer.appendChild(el);
  setTimeout(() => el.remove(), 850);
}

// ============================================================================
// TRANSIENT 3D VFX SYSTEM (Slash Arcs, Projectiles, AOE Telegraph, Particles)
// ============================================================================
interface TransientEffect {
  mesh: THREE.Object3D;
  age: number;
  maxAge: number;
  onUpdate: (dt: number, progress: number) => void;
}
const activeEffects: TransientEffect[] = [];

function spawnSlashArc(pos: THREE.Vector3, facingAngle: number, color = 0x38bdf8, radius = 2.1) {
  const geo = new THREE.RingGeometry(radius * 0.55, radius, 24, 1, -Math.PI * 0.45, Math.PI * 0.9);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.position.y += 1.05;
  mesh.rotation.y = facingAngle - Math.PI / 2;
  scene.add(mesh);

  activeEffects.push({
    mesh,
    age: 0,
    maxAge: 0.24,
    onUpdate: (_dt, p) => {
      mesh.scale.setScalar(1 + p * 0.32);
      mat.opacity = 0.85 * (1 - p);
    },
  });
}

function spawnImpactBurst(pos: THREE.Vector3, color = 0xfbbf24, maxRadius = 1.6) {
  const geo = new THREE.RingGeometry(0.15, 0.45, 28);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.position.y += 0.12;
  scene.add(mesh);

  activeEffects.push({
    mesh,
    age: 0,
    maxAge: 0.38,
    onUpdate: (_dt, p) => {
      const s = 1 + p * (maxRadius / 0.35);
      mesh.scale.setScalar(s);
      mat.opacity = 0.9 * (1 - p);
    },
  });
}

interface HomingBolt {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  target: SkeletonEnemy | null;
  targetPos: THREE.Vector3;
  speed: number;
  damage: number;
  fromEnemy: boolean;
}
const activeBolts: HomingBolt[] = [];

function spawnArcaneBolt(
  startPos: THREE.Vector3,
  target: SkeletonEnemy | null,
  targetPos: THREE.Vector3,
  damage: number,
  color = 0xa855f7,
  fromEnemy = false
) {
  const geo = new THREE.SphereGeometry(0.22, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(startPos);
  scene.add(mesh);

  activeBolts.push({
    mesh,
    pos: startPos.clone(),
    target,
    targetPos: targetPos.clone(),
    speed: fromEnemy ? 9.5 : 14.5,
    damage,
    fromEnemy,
  });
}

// ============================================================================
// HERO CONTROLLER (Real KayKit Adventurer + Hand-Slot Weapons + 132 Rig_Medium Clips)
// ============================================================================
type HeroClassId = 'Knight' | 'Mage' | 'Barbarian';

interface HeroState {
  classId: HeroClassId;
  group: THREE.Group;
  modelRoot: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  activeClipName: string;
  hp: number;
  maxHp: number;
  moveSpeed: number;
  facingAngle: number;
  state: 'idle' | 'run' | 'attack' | 'cast' | 'dodge' | 'hit' | 'dead' | 'inspect';
  stateTimer: number;
  attackComboIdx: number;
  damageDealtInSwing: boolean;
  aoeCooldown: number;
  aoeMaxCooldown: number;
  dodgeCooldown: number;
  plate: HealthPlate;
}

const hero: HeroState = {
  classId: 'Knight',
  group: new THREE.Group(),
  modelRoot: null,
  mixer: null,
  actions: new Map(),
  activeClipName: 'Idle_A',
  hp: 100,
  maxHp: 100,
  moveSpeed: 6.2,
  facingAngle: 0,
  state: 'idle',
  stateTimer: 0,
  attackComboIdx: 0,
  damageDealtInSwing: false,
  aoeCooldown: 0,
  aoeMaxCooldown: 5.0,
  dodgeCooldown: 0,
  plate: createHealthPlate('🛡️ Hiệp Sĩ KayKit', 'hero'),
};
hero.group.position.set(0, 0, 4.5);
scene.add(hero.group);

// Subtle hero ground selection circle
const heroCircleGeo = new THREE.RingGeometry(0.72, 0.88, 32);
heroCircleGeo.rotateX(-Math.PI / 2);
const heroCircleMat = new THREE.MeshBasicMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
});
const heroGroundCircle = new THREE.Mesh(heroCircleGeo, heroCircleMat);
heroGroundCircle.position.y = 0.04;
hero.group.add(heroGroundCircle);

async function loadHeroAnimations() {
  setLoadingText('Đang tải 8 bộ Animation Rig_Medium (132 clip)...');
  for (const packFile of RIG_MEDIUM_PACKS) {
    const gltf = await loadGltf(ANIM_MED_PATH + packFile);
    for (const clip of gltf.animations) {
      if (!masterClips.has(clip.name)) {
        masterClips.set(clip.name, sanitizeInPlaceClip(clip));
      }
    }
  }

  // Populate UI clip selector with all audited Rig_Medium clips
  const selectEl = document.getElementById('all-clips-select') as HTMLSelectElement;
  const countEl = document.getElementById('total-clip-count');
  const sortedNames = [...masterClips.keys()].sort();
  if (countEl) countEl.textContent = String(sortedNames.length);
  if (selectEl) {
    selectEl.innerHTML = '';
    for (const name of sortedNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === 'Idle_A') opt.selected = true;
      selectEl.appendChild(opt);
    }
  }
}

async function setupHeroModel(classId: HeroClassId) {
  hero.classId = classId;
  if (hero.modelRoot) {
    hero.group.remove(hero.modelRoot);
  }
  hero.actions.clear();

  const charFile = `${classId}.glb`;
  const charGltf = await loadGltf(ADV_CHAR_PATH + charFile);
  const cloned = SkeletonUtils.clone(charGltf.scene);
  cloned.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });

  // Attach weapons to real KayKit hand bones (`handslot.r` / `handslotr` and `handslot.l` / `handslotl`)
  const rightHand = findBoneSlot(cloned, ['handslot.r', 'handslotr', 'hand.r', 'handr']);
  const leftHand = findBoneSlot(cloned, ['handslot.l', 'handslotl', 'hand.l', 'handl']);

  if (classId === 'Knight') {
    const sword = (await loadGltf(ADV_ITEM_PATH + 'sword_1handed.gltf')).scene.clone(true);
    const shield = (await loadGltf(ADV_ITEM_PATH + 'shield_badge_color.gltf')).scene.clone(true);
    if (rightHand) rightHand.add(sword);
    if (leftHand) leftHand.add(shield);
    hero.plate.nameEl.textContent = '🛡️ Hiệp Sĩ (Knight)';
    document.getElementById('hero-name-label')!.textContent = '🛡️ Hiệp Sĩ (Knight.glb)';
  } else if (classId === 'Mage') {
    const staff = (await loadGltf(ADV_ITEM_PATH + 'staff.gltf')).scene.clone(true);
    const book = (await loadGltf(ADV_ITEM_PATH + 'spellbook_open.gltf')).scene.clone(true);
    if (rightHand) rightHand.add(staff);
    if (leftHand) leftHand.add(book);
    hero.plate.nameEl.textContent = '🔮 Pháp Sư (Mage)';
    document.getElementById('hero-name-label')!.textContent = '🔮 Pháp Sư (Mage.glb)';
  } else {
    const axe = (await loadGltf(ADV_ITEM_PATH + 'axe_2handed.gltf')).scene.clone(true);
    if (rightHand) rightHand.add(axe);
    hero.plate.nameEl.textContent = '🪓 Chiến Binh (Barbarian)';
    document.getElementById('hero-name-label')!.textContent = '🪓 Chiến Binh (Barbarian.glb)';
  }

  hero.modelRoot = cloned;
  hero.group.add(cloned);

  hero.mixer = new THREE.AnimationMixer(cloned);
  for (const [name, clip] of masterClips.entries()) {
    const action = hero.mixer.clipAction(clip);
    hero.actions.set(name, action);
  }

  hero.activeClipName = '';
  playHeroClip('Idle_A', true, 0.1);
}

function playHeroClip(clipName: string, loop = true, fadeDuration = 0.16) {
  if (!hero.mixer) return;
  const nextAction = hero.actions.get(clipName) || hero.actions.get('Idle_A');
  if (!nextAction) return;

  if (hero.activeClipName === clipName && loop) return;

  const prevAction = hero.actions.get(hero.activeClipName);
  nextAction.reset();
  nextAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  nextAction.clampWhenFinished = !loop;
  nextAction.fadeIn(fadeDuration);
  nextAction.play();

  if (prevAction && prevAction !== nextAction) {
    prevAction.fadeOut(fadeDuration);
  }

  hero.activeClipName = clipName;
  const liveEl = document.getElementById('live-hero-clip');
  if (liveEl) liveEl.textContent = clipName;

  document.querySelectorAll('.anim-btn').forEach((btn) => {
    btn.classList.toggle('playing', (btn as HTMLElement).dataset.clip === clipName);
  });
}

// ============================================================================
// 2 COMPANION PETS WITH REAL RIGGED MODELS & SKELETAL ANIMATIONS (Quaternius CC0)
// ============================================================================
interface CompanionPet {
  id: 'pet1' | 'pet2';
  name: string;
  role: 'melee' | 'ranged';
  enabled: boolean;
  modelFile: string;
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  idleClip: string;
  moveClip: string;
  attackClip: string;
  activeClip: string;
  flankOffset: THREE.Vector3;
  facingAngle: number;
  aiState: 'FOLLOW' | 'APPROACH' | 'ATTACK' | 'RETURN';
  attackTimer: number;
  attackCooldown: number;
  supportHealTimer: number;
  plate: HealthPlate;
}

const pets: CompanionPet[] = [];

async function createCompanionPet(
  id: 'pet1' | 'pet2',
  name: string,
  role: 'melee' | 'ranged',
  modelFile: string,
  flankOffset: THREE.Vector3,
  targetHeight: number,
  ringColor: number
): Promise<CompanionPet> {
  const gltf = await gltfLoader.loadAsync(PET_PATH + modelFile);
  const cloned = gltf.scene;

  // Quaternius GLBs are ~2.4m tall at scale 1.0; scale 0.55 gives a ~1.3m companion beside the 2.2m Knight
  const scaleFactor = modelFile.includes('Wolf')
    ? 0.58
    : modelFile.includes('Fox')
      ? 0.54
      : 0.48;
  cloned.scale.setScalar(scaleFactor);
  cloned.position.set(0, modelFile.includes('Wasp') ? 0.85 : 0, 0);
  cloned.traverse((c) => {
    c.frustumCulled = false;
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });

  const group = new THREE.Group();
  group.position.copy(hero.group.position).add(flankOffset);
  group.add(cloned);

  // Companion aura ring
  const ringGeo = new THREE.RingGeometry(0.55, 0.72, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: ringColor,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.04;
  group.add(ring);

  scene.add(group);

  const mixer = new THREE.AnimationMixer(cloned);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const rawClip of gltf.animations) {
    actions.set(rawClip.name, mixer.clipAction(rawClip));
  }

  const clipNames = [...actions.keys()];
  const findClip = (keywords: string[]) =>
    clipNames.find((n) => keywords.some((k) => n.toLowerCase().includes(k.toLowerCase()))) ||
    clipNames[0] ||
    '';

  const idleClip = findClip(['Idle', 'Flying']);
  const moveClip = findClip(['Gallop', 'Walk', 'Flying']);
  const attackClip = findClip(['Attack']);

  const pet: CompanionPet = {
    id,
    name,
    role,
    enabled: true,
    modelFile,
    group,
    mixer,
    actions,
    idleClip,
    moveClip,
    attackClip,
    activeClip: '',
    flankOffset,
    facingAngle: 0,
    aiState: 'FOLLOW',
    attackTimer: 0,
    attackCooldown: role === 'melee' ? 1.25 : 1.55,
    supportHealTimer: 4.5,
    plate: createHealthPlate(name, 'ally'),
  };

  playPetClip(pet, idleClip, true);
  return pet;
}

function playPetClip(pet: CompanionPet, clipName: string, loop = true) {
  if (!pet.mixer || !clipName) return;
  const next = pet.actions.get(clipName);
  if (!next) return;
  if (pet.activeClip === clipName && loop) return;

  const prev = pet.actions.get(pet.activeClip);
  next.reset();
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = !loop;
  next.fadeIn(0.15);
  next.play();
  if (prev && prev !== next) prev.fadeOut(0.15);

  pet.activeClip = clipName;
  const domId = pet.id === 'pet1' ? 'live-pet1-clip' : 'live-pet2-clip';
  const el = document.getElementById(domId);
  if (el) el.textContent = clipName;
}

async function swapPet2Model() {
  const idx = pets.findIndex((p) => p.id === 'pet2');
  if (idx === -1) return;
  const oldPet = pets[idx];
  const wasEnabled = oldPet.enabled;
  const nextIsWasp = oldPet.modelFile === 'Fox.glb';

  scene.remove(oldPet.group);
  oldPet.plate.el.remove();

  const newPet = await createCompanionPet(
    'pet2',
    nextIsWasp ? '🐝 Ong Tinh Linh (Xa)' : '🦊 Hồ Ly Linh Hồn (Xa)',
    'ranged',
    nextIsWasp ? 'Wasp.glb' : 'Fox.glb',
    new THREE.Vector3(2.1, 0, 1.3),
    nextIsWasp ? 0.95 : 1.05,
    0xa855f7
  );
  newPet.enabled = wasEnabled;
  newPet.group.visible = wasEnabled;
  pets[idx] = newPet;
}

// ============================================================================
// ENEMY SKELETON WAVES (KayKit Skeletons 1.1 + Real Weapons + Animations)
// ============================================================================
interface SkeletonEnemy {
  id: number;
  name: string;
  kind: 'Warrior' | 'Rogue' | 'Minion' | 'Mage';
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  activeClip: string;
  hp: number;
  maxHp: number;
  speed: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  attackTimer: number;
  state: 'spawn' | 'chase' | 'attack' | 'hit' | 'dead';
  stateTimer: number;
  facingAngle: number;
  plate: HealthPlate;
}

const enemies: SkeletonEnemy[] = [];
let nextEnemyId = 1;
let enemiesKilledInWave = 0;
let totalEnemiesInWave = 4;

const SKELETON_SPECS: {
  kind: SkeletonEnemy['kind'];
  name: string;
  charFile: string;
  rightItem: string;
  leftItem?: string;
  hp: number;
  speed: number;
  range: number;
  dmg: number;
}[] = [
  {
    kind: 'Warrior',
    name: '💀 Xương Chiến Binh',
    charFile: 'Skeleton_Warrior.glb',
    rightItem: 'Skeleton_Blade.gltf',
    leftItem: 'Skeleton_Shield_Large_A.gltf',
    hp: 95,
    speed: 3.1,
    range: 1.9,
    dmg: 8,
  },
  {
    kind: 'Rogue',
    name: '💀 Xương Sát Thủ',
    charFile: 'Skeleton_Rogue.glb',
    rightItem: 'Skeleton_Axe.gltf',
    leftItem: 'Skeleton_Shield_Small_A.gltf',
    hp: 75,
    speed: 3.8,
    range: 1.8,
    dmg: 7,
  },
  {
    kind: 'Minion',
    name: '💀 Xương Cảm Tử',
    charFile: 'Skeleton_Minion.glb',
    rightItem: 'Skeleton_Blade.gltf',
    hp: 65,
    speed: 3.5,
    range: 1.75,
    dmg: 6,
  },
  {
    kind: 'Mage',
    name: '💀 Xương Pháp Sư',
    charFile: 'Skeleton_Mage.glb',
    rightItem: 'Skeleton_Staff.gltf',
    hp: 70,
    speed: 2.6,
    range: 6.2,
    dmg: 9,
  },
];

async function preloadSkeletonAssets() {
  setLoadingText('Đang tải 4 chủng loại Quái Xương KayKit & Vũ khí...');
  for (const spec of SKELETON_SPECS) {
    await loadGltf(SKEL_CHAR_PATH + spec.charFile);
    await loadGltf(SKEL_ITEM_PATH + spec.rightItem);
    if (spec.leftItem) await loadGltf(SKEL_ITEM_PATH + spec.leftItem);
  }
}

function playEnemyClip(enemy: SkeletonEnemy, clipName: string, loop = true) {
  const next = enemy.actions.get(clipName) || enemy.actions.get('Idle_A');
  if (!next) return;
  if (enemy.activeClip === clipName && loop) return;

  const prev = enemy.actions.get(enemy.activeClip);
  next.reset();
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = !loop;
  next.fadeIn(0.15);
  next.play();
  if (prev && prev !== next) prev.fadeOut(0.15);
  enemy.activeClip = clipName;
}

async function spawnSkeletonWave() {
  // Clear old enemies
  for (const e of enemies) {
    scene.remove(e.group);
    e.plate.el.remove();
  }
  enemies.length = 0;
  enemiesKilledInWave = 0;

  // Spawn 8 Skeletons across the 5 zones of the 56m x 56m Dungeon Complex
  const spawnPoints = [
    new THREE.Vector3(-5.0, 0, -2.5),
    new THREE.Vector3(5.0, 0, -2.5),
    new THREE.Vector3(-2.2, 0, -5.5),
    new THREE.Vector3(2.4, 0, -5.5),
    new THREE.Vector3(-15.5, 0, 1.5),
    new THREE.Vector3(15.5, 0, 1.5),
    new THREE.Vector3(-7.0, 0, -10.5),
    new THREE.Vector3(7.0, 0, -10.5),
  ];
  totalEnemiesInWave = spawnPoints.length;

  // Close chest and lock until wave cleared
  chestState = 'locked';
  chestOpenProgress = 0;
  if (rewardChestLid) rewardChestLid.rotation.x = 0;
  document.getElementById('reward-modal')?.classList.add('hidden');
  updateWaveStatusUI();

  for (let i = 0; i < spawnPoints.length; i++) {
    const spec = SKELETON_SPECS[i % SKELETON_SPECS.length];
    const charGltf = modelCache.get(SKEL_CHAR_PATH + spec.charFile)!;
    const cloned = SkeletonUtils.clone(charGltf.scene);

    const rightHand = findBoneSlot(cloned, ['handslot.r', 'handslotr', 'hand.r', 'handr']);
    const leftHand = findBoneSlot(cloned, ['handslot.l', 'handslotl', 'hand.l', 'handl']);

    if (rightHand && spec.rightItem) {
      const weapon = modelCache.get(SKEL_ITEM_PATH + spec.rightItem)!.scene.clone(true);
      rightHand.add(weapon);
    }
    if (leftHand && spec.leftItem) {
      const offhand = modelCache.get(SKEL_ITEM_PATH + spec.leftItem)!.scene.clone(true);
      leftHand.add(offhand);
    }

    const group = new THREE.Group();
    const sp = spawnPoints[i % spawnPoints.length];
    group.position.set(sp.x, getFloorHeight(sp.x, sp.z), sp.z);
    group.add(cloned);

    // Red enemy ground ring
    const ringGeo = new THREE.RingGeometry(0.62, 0.76, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.03;
    group.add(ring);

    scene.add(group);

    const mixer = new THREE.AnimationMixer(cloned);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const [name, clip] of masterClips.entries()) {
      actions.set(name, mixer.clipAction(clip));
    }

    const enemy: SkeletonEnemy = {
      id: nextEnemyId++,
      name: spec.name,
      kind: spec.kind,
      group,
      mixer,
      actions,
      activeClip: '',
      hp: spec.hp,
      maxHp: spec.hp,
      speed: spec.speed,
      attackRange: spec.range,
      attackDamage: spec.dmg,
      attackCooldown: spec.kind === 'Mage' ? 2.4 : 1.7,
      attackTimer: 0.8 + i * 0.25,
      state: 'spawn',
      stateTimer: 0.95,
      facingAngle: 0,
      plate: createHealthPlate(spec.name, 'enemy'),
    };

    const spawnClip = masterClips.has('Skeletons_Awaken_Floor')
      ? 'Skeletons_Awaken_Floor'
      : 'Spawn_Ground';
    playEnemyClip(enemy, spawnClip, false);
    spawnImpactBurst(group.position, 0xef4444, 1.4);
    enemies.push(enemy);
  }
}

function damageEnemy(enemy: SkeletonEnemy, amount: number, sourceLabel = '') {
  if (enemy.state === 'dead') return;
  enemy.hp = Math.max(0, enemy.hp - amount);
  enemy.plate.fillEl.style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;

  const popupColor = sourceLabel === 'AOE' ? '#c084fc' : sourceLabel === 'PET' ? '#34d399' : '#fde047';
  spawnDamagePopup(enemy.group.position, `-${Math.round(amount)}`, popupColor);
  spawnImpactBurst(enemy.group.position, popupColor === '#c084fc' ? 0xa855f7 : 0xfbbf24, 1.1);

  if (enemy.hp <= 0) {
    enemy.state = 'dead';
    enemy.stateTimer = 3.0;
    const deathClip = masterClips.has('Skeletons_Death') ? 'Skeletons_Death' : 'Death_A';
    playEnemyClip(enemy, deathClip, false);
    enemiesKilledInWave++;
    updateWaveStatusUI();

    if (enemiesKilledInWave >= totalEnemiesInWave) {
      unlockAndOpenRewardChest();
    }
  } else if (enemy.state !== 'attack') {
    enemy.state = 'hit';
    enemy.stateTimer = 0.35;
    playEnemyClip(enemy, 'Hit_A', false);
  }
}

function updateWaveStatusUI() {
  const statusEl = document.getElementById('wave-status-text');
  if (!statusEl) return;
  if (enemiesKilledInWave >= totalEnemiesInWave) {
    statusEl.textContent = `🎉 Đã diệt gọn ${enemiesKilledInWave}/${totalEnemiesInWave} Bộ Xương! Rương Báu trên bục cao đã mở!`;
  } else {
    statusEl.textContent = `Mục tiêu: Diệt đợt Bộ Xương (${enemiesKilledInWave}/${totalEnemiesInWave}) để mở Rương Báu trên bục cao`;
  }
}

function unlockAndOpenRewardChest() {
  if (chestState === 'opening' || chestState === 'opened') return;
  chestState = 'opening';
  if (rewardChestGroup) {
    spawnImpactBurst(rewardChestGroup.position, 0xfbbf24, 3.2);
    spawnDamagePopup(rewardChestGroup.position, '🎁 RƯƠNG BÁU MỞ!', '#fbbf24');
  }
  playHeroClip('Cheering', false);
  setTimeout(() => {
    document.getElementById('reward-modal')?.classList.remove('hidden');
  }, 1150);
}

// ============================================================================
// AOE TELEGRAPH & DETONATION SYSTEM (Warning Ring -> Fill -> Impact)
// ============================================================================
interface ActiveAoeTelegraph {
  center: THREE.Vector3;
  radius: number;
  elapsed: number;
  duration: number;
  outerRing: THREE.Mesh;
  innerFill: THREE.Mesh;
}
const activeTelegraphs: ActiveAoeTelegraph[] = [];

function triggerHeroAoeSkill() {
  if (hero.state === 'dead') return;
  if (hero.aoeCooldown > 0) return;

  hero.aoeCooldown = hero.aoeMaxCooldown;
  hero.state = 'cast';
  hero.stateTimer = 0.72;

  // Target center of living enemies, or 3.5m in front of hero
  const living = enemies.filter((e) => e.state !== 'dead');
  const targetPos = new THREE.Vector3();
  if (living.length > 0) {
    // Pick nearest enemy and cluster around it
    living.sort(
      (a, b) =>
        a.group.position.distanceToSquared(hero.group.position) -
        b.group.position.distanceToSquared(hero.group.position)
    );
    targetPos.copy(living[0].group.position);
  } else {
    targetPos
      .copy(hero.group.position)
      .add(new THREE.Vector3(Math.sin(hero.facingAngle) * 3.6, 0, Math.cos(hero.facingAngle) * 3.6));
  }
  targetPos.y = getFloorHeight(targetPos.x, targetPos.z) + 0.05;

  // Face towards target
  const dx = targetPos.x - hero.group.position.x;
  const dz = targetPos.z - hero.group.position.z;
  if (dx * dx + dz * dz > 0.01) {
    hero.facingAngle = Math.atan2(dx, dz);
    hero.group.rotation.y = hero.facingAngle;
  }

  playHeroClip('Ranged_Magic_Spellcasting', false);

  const radius = 3.3;
  const outerGeo = new THREE.RingGeometry(radius - 0.16, radius, 48);
  outerGeo.rotateX(-Math.PI / 2);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
  const outerRing = new THREE.Mesh(outerGeo, outerMat);
  outerRing.position.copy(targetPos);
  scene.add(outerRing);

  const innerGeo = new THREE.CircleGeometry(radius, 48);
  innerGeo.rotateX(-Math.PI / 2);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xa855f7,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.38,
  });
  const innerFill = new THREE.Mesh(innerGeo, innerMat);
  innerFill.position.copy(targetPos);
  innerFill.scale.setScalar(0.05);
  scene.add(innerFill);

  activeTelegraphs.push({
    center: targetPos,
    radius,
    elapsed: 0,
    duration: 0.85,
    outerRing,
    innerFill,
  });
}

function detonateAoeTelegraph(t: ActiveAoeTelegraph) {
  // Spawn 3D Energy Pillar + Shockwave Ring
  const pillarGeo = new THREE.CylinderGeometry(t.radius * 0.65, t.radius * 0.85, 6.5, 28, 1, true);
  const pillarMat = new THREE.MeshBasicMaterial({
    color: 0xc084fc,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
  });
  const pillarMesh = new THREE.Mesh(pillarGeo, pillarMat);
  pillarMesh.position.copy(t.center);
  pillarMesh.position.y += 3.2;
  scene.add(pillarMesh);

  activeEffects.push({
    mesh: pillarMesh,
    age: 0,
    maxAge: 0.48,
    onUpdate: (_dt, p) => {
      pillarMesh.scale.set(1 + p * 0.35, 1 + p * 0.2, 1 + p * 0.35);
      pillarMat.opacity = 0.78 * (1 - p);
    },
  });

  spawnImpactBurst(t.center, 0xc084fc, t.radius * 1.35);
  spawnImpactBurst(t.center, 0xf43f5e, t.radius * 1.05);

  for (const enemy of enemies) {
    if (enemy.state === 'dead') continue;
    const dist = enemy.group.position.distanceTo(t.center);
    if (dist <= t.radius + 0.65) {
      damageEnemy(enemy, 46, 'AOE');
      // Knockback slightly away from center
      const push = enemy.group.position.clone().sub(t.center);
      push.y = 0;
      if (push.lengthSq() > 0.01) {
        push.normalize().multiplyScalar(0.95);
        enemy.group.position.x = THREE.MathUtils.clamp(enemy.group.position.x + push.x, -22.5, 22.5);
        enemy.group.position.z = THREE.MathUtils.clamp(enemy.group.position.z + push.z, -22.0, 22.0);
      }
    }
  }
}

// ============================================================================
// HERO MELEE ATTACK & DODGE ACTIONS
// ============================================================================
const MELEE_COMBO_CLIPS = [
  'Melee_1H_Attack_Slice_Horizontal',
  'Melee_1H_Attack_Chop',
  'Melee_2H_Attack_Spin',
];

function triggerHeroMeleeAttack() {
  if (hero.state === 'dead' || hero.state === 'dodge') return;
  if (hero.state === 'attack' && hero.stateTimer > 0.15) return;

  // Auto-face nearest skeleton within 4.5m if any
  const living = enemies.filter((e) => e.state !== 'dead');
  if (living.length > 0) {
    living.sort(
      (a, b) =>
        a.group.position.distanceToSquared(hero.group.position) -
        b.group.position.distanceToSquared(hero.group.position)
    );
    const nearest = living[0];
    if (nearest.group.position.distanceTo(hero.group.position) <= 4.8) {
      const dx = nearest.group.position.x - hero.group.position.x;
      const dz = nearest.group.position.z - hero.group.position.z;
      hero.facingAngle = Math.atan2(dx, dz);
      hero.group.rotation.y = hero.facingAngle;
    }
  }

  const clipName = MELEE_COMBO_CLIPS[hero.attackComboIdx % MELEE_COMBO_CLIPS.length];
  hero.attackComboIdx++;
  hero.state = 'attack';
  hero.stateTimer = 0.52;
  hero.damageDealtInSwing = false;

  playHeroClip(clipName, false, 0.1);
  spawnSlashArc(
    hero.group.position,
    hero.facingAngle,
    hero.classId === 'Mage' ? 0xa855f7 : 0x38bdf8,
    2.35
  );
}

function triggerHeroDodge() {
  if (hero.state === 'dead' || hero.dodgeCooldown > 0) return;
  hero.dodgeCooldown = 1.1;
  hero.state = 'dodge';
  hero.stateTimer = 0.42;
  playHeroClip('Dodge_Forward', false, 0.08);
  spawnImpactBurst(hero.group.position, 0x38bdf8, 1.3);
}

// ============================================================================
// INPUT HANDLING (WASD + Space + J/K + Mouse + UI Controls)
// ============================================================================
const keysDown = new Set<string>();

window.addEventListener('keydown', (e) => {
  const code = e.code;
  keysDown.add(code);

  if (code === 'Space') {
    e.preventDefault();
    triggerHeroDodge();
  } else if (code === 'KeyJ') {
    triggerHeroMeleeAttack();
  } else if (code === 'KeyK') {
    triggerHeroAoeSkill();
  } else if (code === 'KeyH') {
    toggleHudVisibility();
  }
});

window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    triggerHeroMeleeAttack();
  } else if (e.button === 2) {
    triggerHeroAoeSkill();
  }
});

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener(
  'wheel',
  (e) => {
    cameraZoom = THREE.MathUtils.clamp(cameraZoom + e.deltaY * 0.0008, 0.45, 2.1);
  },
  { passive: true }
);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================================
// UI BUTTON BINDINGS
// ============================================================================
function toggleHudVisibility(forceVisible?: boolean) {
  const hudRoot = document.getElementById('hud-root')!;
  const restoreBtn = document.getElementById('btn-restore-hud')!;
  const hideNow = forceVisible !== undefined ? !forceVisible : !hudRoot.classList.contains('hidden');
  hudRoot.classList.toggle('hidden', hideNow);
  restoreBtn.classList.toggle('hidden', !hideNow);
  worldLabelsContainer.style.display = hideNow ? 'none' : 'block';
}

function resetEntireRoom() {
  hero.hp = hero.maxHp;
  hero.state = 'idle';
  hero.stateTimer = 0;
  hero.aoeCooldown = 0;
  hero.group.position.set(0, 0, 4.5);
  hero.facingAngle = Math.PI; // Face North toward skeletons and dais
  hero.group.rotation.y = hero.facingAngle;
  playHeroClip('Idle_A', true);
  updateHeroHpUI();

  for (const pet of pets) {
    pet.group.position.copy(hero.group.position).add(pet.flankOffset);
    pet.aiState = 'FOLLOW';
    playPetClip(pet, pet.idleClip, true);
  }

  spawnSkeletonWave();
}

function updateHeroHpUI() {
  const fill = document.getElementById('hero-hp-fill');
  const txt = document.getElementById('hero-hp-text');
  const pct = Math.max(0, (hero.hp / hero.maxHp) * 100);
  if (fill) fill.style.width = `${pct}%`;
  if (txt) txt.textContent = `${Math.round(hero.hp)} / ${hero.maxHp} HP`;
  hero.plate.fillEl.style.width = `${pct}%`;
}

function bindUIEvents() {
  document.getElementById('btn-toggle-pet1')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const pet1 = pets.find((p) => p.id === 'pet1');
    if (!pet1) return;
    pet1.enabled = !pet1.enabled;
    pet1.group.visible = pet1.enabled;
    btn.classList.toggle('active', pet1.enabled);
    btn.querySelector('.state-pill')!.textContent = pet1.enabled ? 'BẬT' : 'TẮT';
  });

  document.getElementById('btn-toggle-pet2')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const pet2 = pets.find((p) => p.id === 'pet2');
    if (!pet2) return;
    pet2.enabled = !pet2.enabled;
    pet2.group.visible = pet2.enabled;
    btn.classList.toggle('active', pet2.enabled);
    btn.querySelector('.state-pill')!.textContent = pet2.enabled ? 'BẬT' : 'TẮT';
  });

  document.getElementById('btn-swap-pet2-model')?.addEventListener('click', () => {
    swapPet2Model();
  });

  document.getElementById('btn-spawn-wave')?.addEventListener('click', () => {
    spawnSkeletonWave();
  });

  document.getElementById('btn-cast-aoe')?.addEventListener('click', () => {
    triggerHeroAoeSkill();
  });

  document.getElementById('btn-reset-room')?.addEventListener('click', () => {
    resetEntireRoom();
  });

  document.getElementById('btn-hide-hud')?.addEventListener('click', () => {
    toggleHudVisibility(false);
  });

  document.getElementById('btn-restore-hud')?.addEventListener('click', () => {
    toggleHudVisibility(true);
  });

  document.getElementById('btn-play-again')?.addEventListener('click', () => {
    resetEntireRoom();
  });

  document.getElementById('btn-close-reward')?.addEventListener('click', () => {
    document.getElementById('reward-modal')?.classList.add('hidden');
  });

  // Camera presets
  document.querySelectorAll('[data-cam]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-cam]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      cameraMode = (btn as HTMLElement).dataset.cam as typeof cameraMode;
    });
  });

  // Hero Class switcher
  document.querySelectorAll('[data-hero]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('[data-hero]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const heroId = (btn as HTMLElement).dataset.hero as HeroClassId;
      await setupHeroModel(heroId);
    });
  });

  // Quick animation buttons
  document.querySelectorAll('.anim-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const clipName = (btn as HTMLElement).dataset.clip!;
      hero.state = 'inspect';
      hero.stateTimer = 2.2;
      const isLoop = clipName.includes('Idle') || clipName.includes('Running');
      playHeroClip(clipName, isLoop, 0.14);
      const selectEl = document.getElementById('all-clips-select') as HTMLSelectElement;
      if (selectEl) selectEl.value = clipName;
    });
  });

  // All 132 clips dropdown
  document.getElementById('all-clips-select')?.addEventListener('change', (e) => {
    const clipName = (e.target as HTMLSelectElement).value;
    hero.state = 'inspect';
    hero.stateTimer = 2.6;
    const isLoop = clipName.includes('Idle') || clipName.includes('Running') || clipName.includes('Walking');
    playHeroClip(clipName, isLoop, 0.14);
  });
}

// ============================================================================
// MAIN GAME LOOP (Hero, Pet Steering AI, Skeleton Wave, AOE, Chest & Camera)
// ============================================================================
const clock = new THREE.Clock();

function updateHero(dt: number) {
  if (hero.mixer) hero.mixer.update(dt);

  if (hero.aoeCooldown > 0) {
    hero.aoeCooldown = Math.max(0, hero.aoeCooldown - dt);
  }
  const aoeBadge = document.getElementById('aoe-cd-badge');
  if (aoeBadge) {
    aoeBadge.textContent =
      hero.aoeCooldown > 0 ? `${hero.aoeCooldown.toFixed(1)}s` : 'Sẵn sàng (K)';
  }

  if (hero.dodgeCooldown > 0) {
    hero.dodgeCooldown = Math.max(0, hero.dodgeCooldown - dt);
  }

  if (hero.state === 'dead') {
    updateHealthPlatePosition(hero.plate, hero.group.position, 2.55, true);
    return;
  }

  // Movement vector from WASD / Arrows
  let moveX = 0;
  let moveZ = 0;
  if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) moveZ -= 1;
  if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) moveZ += 1;
  if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) moveX -= 1;
  if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) moveX += 1;
  const isMovingInput = moveX !== 0 || moveZ !== 0;

  // Handle timed action states
  if (hero.state === 'dodge') {
    hero.stateTimer -= dt;
    const dashSpeed = 12.5;
    hero.group.position.x += Math.sin(hero.facingAngle) * dashSpeed * dt;
    hero.group.position.z += Math.cos(hero.facingAngle) * dashSpeed * dt;
    clampPositionToRoom(hero.group.position);
    if (hero.stateTimer <= 0) {
      hero.state = 'idle';
    }
  } else if (hero.state === 'attack') {
    hero.stateTimer -= dt;
    // Deal melee damage mid-swing
    if (!hero.damageDealtInSwing && hero.stateTimer <= 0.3) {
      hero.damageDealtInSwing = true;
      for (const enemy of enemies) {
        if (enemy.state === 'dead') continue;
        const dist = enemy.group.position.distanceTo(hero.group.position);
        if (dist <= 2.85) {
          damageEnemy(enemy, 28, 'HERO');
        }
      }
    }
    if (hero.stateTimer <= 0) {
      hero.state = 'idle';
    }
  } else if (hero.state === 'cast' || hero.state === 'hit') {
    hero.stateTimer -= dt;
    if (hero.stateTimer <= 0) {
      hero.state = 'idle';
    }
  } else if (hero.state === 'inspect') {
    hero.stateTimer -= dt;
    if (isMovingInput || hero.stateTimer <= 0) {
      hero.state = 'idle';
    }
  }

  // Standard locomotion when in idle/run
  if (hero.state === 'idle' || hero.state === 'run') {
    if (isMovingInput) {
      const len = Math.hypot(moveX, moveZ);
      moveX /= len;
      moveZ /= len;
      hero.group.position.x += moveX * hero.moveSpeed * dt;
      hero.group.position.z += moveZ * hero.moveSpeed * dt;
      clampPositionToRoom(hero.group.position);

      const targetAngle = Math.atan2(moveX, moveZ);
      hero.facingAngle = lerpAngle(hero.facingAngle, targetAngle, 14 * dt);
      hero.group.rotation.y = hero.facingAngle;

      hero.state = 'run';
      playHeroClip('Running_A', true, 0.14);
    } else {
      hero.state = 'idle';
      playHeroClip('Idle_A', true, 0.16);
    }
  }

  hero.group.position.y = getFloorHeight(hero.group.position.x, hero.group.position.z);
  updateHealthPlatePosition(hero.plate, hero.group.position, 2.55, true);
}

function updateCompanionPets(dt: number) {
  const livingEnemies = enemies.filter((e) => e.state !== 'dead');

  for (const pet of pets) {
    if (!pet.enabled) {
      updateHealthPlatePosition(pet.plate, pet.group.position, 1.65, false);
      continue;
    }
    if (pet.mixer) pet.mixer.update(dt);

    pet.attackTimer = Math.max(0, pet.attackTimer - dt);

    // Support heal aura from Pet 2 (Ranged/Support companion)
    if (pet.role === 'ranged') {
      pet.supportHealTimer -= dt;
      if (pet.supportHealTimer <= 0) {
        pet.supportHealTimer = 5.5;
        if (hero.hp < hero.maxHp && hero.state !== 'dead') {
          hero.hp = Math.min(hero.maxHp, hero.hp + 12);
          updateHeroHpUI();
          spawnDamagePopup(hero.group.position, '+12 HP (Thú Hỗ Trợ)', '#34d399');
          spawnImpactBurst(hero.group.position, 0x10b981, 1.45);
        }
      }
    }

    // Desired flank slot relative to hero
    const desiredFlank = hero.group.position.clone().add(pet.flankOffset);
    const distToHero = pet.group.position.distanceTo(hero.group.position);

    // Find nearest living enemy
    let nearestEnemy: SkeletonEnemy | null = null;
    let nearestDist = Infinity;
    for (const e of livingEnemies) {
      const d = e.group.position.distanceTo(pet.group.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearestEnemy = e;
      }
    }

    // 4-State Companion Steering AI: FOLLOW -> APPROACH -> ATTACK -> RETURN
    if (distToHero > 12.5 || !nearestEnemy) {
      pet.aiState = distToHero > 2.2 ? 'RETURN' : 'FOLLOW';
    } else {
      const engageRange = pet.role === 'melee' ? 1.85 : 5.8;
      if (nearestDist <= engageRange) {
        pet.aiState = 'ATTACK';
      } else {
        pet.aiState = 'APPROACH';
      }
    }

    const steering = new THREE.Vector3();

    if (pet.aiState === 'FOLLOW' || pet.aiState === 'RETURN') {
      const toFlank = desiredFlank.clone().sub(pet.group.position);
      toFlank.y = 0;
      if (toFlank.length() > 0.45) {
        steering.add(toFlank.normalize().multiplyScalar(5.5));
      }
    } else if (pet.aiState === 'APPROACH' && nearestEnemy) {
      const toEnemy = nearestEnemy.group.position.clone().sub(pet.group.position);
      toEnemy.y = 0;
      if (toEnemy.length() > 0.1) {
        steering.add(toEnemy.normalize().multiplyScalar(pet.role === 'melee' ? 6.0 : 4.8));
      }
    } else if (pet.aiState === 'ATTACK' && nearestEnemy) {
      // Ranged pet keeps comfortable distance if enemy gets too close
      if (pet.role === 'ranged' && nearestDist < 3.1) {
        const away = pet.group.position.clone().sub(nearestEnemy.group.position);
        away.y = 0;
        if (away.lengthSq() > 0.01) {
          steering.add(away.normalize().multiplyScalar(3.6));
        }
      }
    }

    // Separation force: never overlap Hero, the other Pet, or Enemies
    const pushAway = (otherPos: THREE.Vector3, minDist: number, weight: number) => {
      const diff = pet.group.position.clone().sub(otherPos);
      diff.y = 0;
      const d = diff.length();
      if (d > 0.001 && d < minDist) {
        steering.add(diff.normalize().multiplyScalar(((minDist - d) / minDist) * weight));
      }
    };

    pushAway(hero.group.position, 1.55, 5.0);
    for (const otherPet of pets) {
      if (otherPet !== pet && otherPet.enabled) {
        pushAway(otherPet.group.position, 1.75, 5.5);
      }
    }
    for (const e of livingEnemies) {
      pushAway(e.group.position, 1.35, 3.5);
    }

    // Apply movement & animation
    const speed = steering.length();
    if (speed > 0.35) {
      const moveStep = steering.normalize().multiplyScalar(Math.min(speed, 5.8) * dt);
      pet.group.position.add(moveStep);
      clampPositionToRoom(pet.group.position);

      const moveAngle = Math.atan2(moveStep.x, moveStep.z);
      pet.facingAngle = lerpAngle(pet.facingAngle, moveAngle, 12 * dt);
      pet.group.rotation.y = pet.facingAngle;

      if (pet.attackTimer <= pet.attackCooldown - 0.38) {
        playPetClip(pet, pet.moveClip, true);
      }
    } else {
      if (nearestEnemy) {
        const dx = nearestEnemy.group.position.x - pet.group.position.x;
        const dz = nearestEnemy.group.position.z - pet.group.position.z;
        pet.facingAngle = lerpAngle(pet.facingAngle, Math.atan2(dx, dz), 12 * dt);
        pet.group.rotation.y = pet.facingAngle;
      }
      if (pet.attackTimer <= pet.attackCooldown - 0.38) {
        playPetClip(pet, pet.idleClip, true);
      }
    }

    // Execute Pet Attack when in range and cooldown ready
    if (pet.aiState === 'ATTACK' && nearestEnemy && pet.attackTimer <= 0) {
      pet.attackTimer = pet.attackCooldown;
      playPetClip(pet, pet.attackClip, false);

      if (pet.role === 'melee') {
        spawnSlashArc(pet.group.position, pet.facingAngle, 0x34d399, 1.5);
        damageEnemy(nearestEnemy, 16, 'PET');
      } else {
        const boltStart = pet.group.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        spawnArcaneBolt(
          boltStart,
          nearestEnemy,
          nearestEnemy.group.position.clone().add(new THREE.Vector3(0, 1.0, 0)),
          14,
          0xa855f7,
          false
        );
      }
    }

    pet.group.position.y = getFloorHeight(pet.group.position.x, pet.group.position.z);
    updateHealthPlatePosition(pet.plate, pet.group.position, 1.65, true);
  }
}

function updateEnemies(dt: number) {
  for (const enemy of enemies) {
    enemy.mixer.update(dt);

    if (enemy.state === 'dead') {
      updateHealthPlatePosition(enemy.plate, enemy.group.position, 2.3, false);
      continue;
    }

    enemy.attackTimer = Math.max(0, enemy.attackTimer - dt);

    if (enemy.state === 'spawn' || enemy.state === 'hit') {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
      }
      updateHealthPlatePosition(enemy.plate, enemy.group.position, 2.3, true);
      continue;
    }

    const toHero = hero.group.position.clone().sub(enemy.group.position);
    toHero.y = 0;
    const distToHero = toHero.length();

    if (distToHero > 0.05) {
      const targetAngle = Math.atan2(toHero.x, toHero.z);
      enemy.facingAngle = lerpAngle(enemy.facingAngle, targetAngle, 10 * dt);
      enemy.group.rotation.y = enemy.facingAngle;
    }

    if (distToHero > enemy.attackRange) {
      enemy.state = 'chase';
      const dir = toHero.normalize();

      // Separation between skeletons so they surround the player naturally
      for (const other of enemies) {
        if (other !== enemy && other.state !== 'dead') {
          const diff = enemy.group.position.clone().sub(other.group.position);
          diff.y = 0;
          const d = diff.length();
          if (d > 0.01 && d < 1.55) {
            dir.add(diff.normalize().multiplyScalar(1.35));
          }
        }
      }
      dir.normalize();
      enemy.group.position.x += dir.x * enemy.speed * dt;
      enemy.group.position.z += dir.z * enemy.speed * dt;
      clampPositionToRoom(enemy.group.position);

      const walkClip = masterClips.has('Skeletons_Walking') ? 'Skeletons_Walking' : 'Running_A';
      playEnemyClip(enemy, walkClip, true);
    } else {
      enemy.state = 'attack';
      if (enemy.attackTimer <= 0) {
        enemy.attackTimer = enemy.attackCooldown;
        const atkClip =
          enemy.kind === 'Mage' ? 'Ranged_Magic_Shoot' : 'Melee_1H_Attack_Chop';
        playEnemyClip(enemy, atkClip, false);

        if (enemy.kind === 'Mage') {
          const startPos = enemy.group.position.clone().add(new THREE.Vector3(0, 1.2, 0));
          spawnArcaneBolt(
            startPos,
            null,
            hero.group.position.clone().add(new THREE.Vector3(0, 1.0, 0)),
            enemy.attackDamage,
            0xef4444,
            true
          );
        } else if (hero.state !== 'dodge' && hero.state !== 'dead') {
          setTimeout(() => {
            if (enemy.state === 'dead' || hero.state === 'dead' || hero.state === 'dodge') return;
            if (enemy.group.position.distanceTo(hero.group.position) <= enemy.attackRange + 0.7) {
              damageHero(enemy.attackDamage);
            }
          }, 260);
        }
      } else if (enemy.attackTimer < enemy.attackCooldown - 0.55) {
        playEnemyClip(enemy, 'Idle_A', true);
      }
    }

    enemy.group.position.y = getFloorHeight(enemy.group.position.x, enemy.group.position.z);
    updateHealthPlatePosition(enemy.plate, enemy.group.position, 2.3, true);
  }
}

function damageHero(amount: number) {
  if (hero.state === 'dead' || hero.state === 'dodge') return;
  hero.hp = Math.max(0, hero.hp - amount);
  updateHeroHpUI();
  spawnDamagePopup(hero.group.position, `-${amount}`, '#f87171');

  if (hero.hp <= 0) {
    hero.state = 'dead';
    playHeroClip('Death_A', false);
    // Auto revive after 2.8s in preview so the user isn't stuck
    setTimeout(() => {
      if (hero.state === 'dead') {
        hero.hp = hero.maxHp;
        hero.state = 'idle';
        playHeroClip('Idle_A', true);
        updateHeroHpUI();
      }
    }, 2800);
  } else if (hero.state === 'idle' || hero.state === 'run') {
    hero.state = 'hit';
    hero.stateTimer = 0.28;
    playHeroClip('Hit_A', false);
  }
}

function updateProjectilesAndTelegraphs(dt: number) {
  // Update Homing / Ranged Bolts
  for (let i = activeBolts.length - 1; i >= 0; i--) {
    const b = activeBolts[i];
    if (!b.fromEnemy && b.target && b.target.state !== 'dead') {
      b.targetPos.copy(b.target.group.position).add(new THREE.Vector3(0, 1.0, 0));
    }
    const toTarget = b.targetPos.clone().sub(b.pos);
    const dist = toTarget.length();
    if (dist <= 0.45) {
      if (b.fromEnemy) {
        if (hero.group.position.distanceTo(b.pos) <= 1.6) {
          damageHero(b.damage);
        }
      } else if (b.target && b.target.state !== 'dead') {
        damageEnemy(b.target, b.damage, 'PET');
      }
      scene.remove(b.mesh);
      activeBolts.splice(i, 1);
    } else {
      b.pos.add(toTarget.normalize().multiplyScalar(b.speed * dt));
      b.mesh.position.copy(b.pos);
    }
  }

  // Update AOE Telegraphs
  for (let i = activeTelegraphs.length - 1; i >= 0; i--) {
    const t = activeTelegraphs[i];
    t.elapsed += dt;
    const progress = Math.min(1, t.elapsed / t.duration);
    t.innerFill.scale.setScalar(Math.max(0.05, progress));
    (t.outerRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(progress * Math.PI * 6) * 0.35;

    if (t.elapsed >= t.duration) {
      scene.remove(t.outerRing);
      scene.remove(t.innerFill);
      activeTelegraphs.splice(i, 1);
      detonateAoeTelegraph(t);
    }
  }

  // Update Transient VFX
  for (let i = activeEffects.length - 1; i >= 0; i--) {
    const fx = activeEffects[i];
    fx.age += dt;
    const p = Math.min(1, fx.age / fx.maxAge);
    fx.onUpdate(dt, p);
    if (fx.age >= fx.maxAge) {
      scene.remove(fx.mesh);
      activeEffects.splice(i, 1);
    }
  }
}

function updateEnvironmentAndCamera(dt: number, elapsedTime: number) {
  // Flicker torch lights
  for (const t of torchLights) {
    const flicker =
      Math.sin(elapsedTime * 7.5 + t.phase) * 0.25 +
      Math.cos(elapsedTime * 13.0 + t.phase) * 0.15;
    t.light.intensity = t.baseIntensity + flicker;
    const s = 1.0 + flicker * 0.18;
    t.flameMesh.scale.set(s, s * 1.25, s);
  }

  // Animate Reward Chest Lid & Ring
  if (rewardChestRing) {
    rewardChestRing.rotation.z = elapsedTime * 0.8;
    const mat = rewardChestRing.material as THREE.MeshBasicMaterial;
    mat.opacity = chestState === 'locked' ? 0.25 : 0.65 + Math.sin(elapsedTime * 4) * 0.25;
  }
  if (chestState === 'opening' && rewardChestLid) {
    chestOpenProgress = Math.min(1, chestOpenProgress + dt * 1.8);
    rewardChestLid.rotation.x = -chestOpenProgress * 1.18;
    if (chestOpenProgress >= 1) {
      chestState = 'opened';
    }
  }

  // Update Camera smoothly based on preset mode across the 56m x 56m Dungeon Complex
  const targetLook = new THREE.Vector3();
  const desiredCamPos = new THREE.Vector3();

  if (cameraMode === 'overview') {
    targetLook.set(0, 0.8, -2.5);
    desiredCamPos.set(0, 32.0 * cameraZoom, 29.5 * cameraZoom);
  } else if (cameraMode === 'closeup') {
    targetLook.copy(hero.group.position).add(new THREE.Vector3(0, 1.3, -0.5));
    desiredCamPos
      .copy(hero.group.position)
      .add(new THREE.Vector3(0, 6.2 * cameraZoom, 7.2 * cameraZoom));
  } else {
    // 1:1 Smooth Follow 3/4 Isometric Angled Top-Down Camera across all 5 Dungeon Zones
    targetLook.set(
      THREE.MathUtils.clamp(hero.group.position.x, -18.5, 18.5),
      hero.group.position.y * 0.6 + 0.8,
      THREE.MathUtils.clamp(hero.group.position.z - 1.2, -19.5, 18.0)
    );
    desiredCamPos.set(
      targetLook.x,
      15.8 * cameraZoom,
      targetLook.z + 15.2 * cameraZoom
    );
  }

  camera.position.lerp(desiredCamPos, Math.min(1, dt * 6.5));
  camera.lookAt(targetLook);
}

// ============================================================================
// UTILITY MATH HELPERS
// ============================================================================
function clampPositionToRoom(pos: THREE.Vector3) {
  pos.x = THREE.MathUtils.clamp(pos.x, -22.5, 22.5);
  pos.z = THREE.MathUtils.clamp(pos.z, -22.0, 22.0);
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(1, t);
}

// ============================================================================
// INITIALIZE EVERYTHING & EXPOSE AUTOMATION HOOKS
// ============================================================================
async function init() {
  try {
    await buildDungeonRoom();
    await loadHeroAnimations();
    await setupHeroModel('Knight');

    setLoadingText('Đang khởi tạo 2 Thú Đồng Hành Rigged (Sói Cận Chiến & Hồ Ly Đánh Xa)...');
    const pet1 = await createCompanionPet(
      'pet1',
      '🐺 Sói Chiến (Cận Chiến)',
      'melee',
      'Wolf.glb',
      new THREE.Vector3(-2.1, 0, 1.3),
      1.12,
      0x10b981
    );
    const pet2 = await createCompanionPet(
      'pet2',
      '🦊 Hồ Ly Linh Hồn (Xa)',
      'ranged',
      'Fox.glb',
      new THREE.Vector3(2.1, 0, 1.3),
      1.05,
      0xa855f7
    );
    pets.push(pet1, pet2);

    await preloadSkeletonAssets();
    await spawnSkeletonWave();

    bindUIEvents();

    // Hide loading overlay
    document.getElementById('loading-overlay')?.classList.add('hidden');

    // Expose automation & inspection hooks on window
    (window as unknown as Record<string, unknown>).__previewAPI = {
      getState: () => ({
        heroClip: hero.activeClipName,
        heroHp: hero.hp,
        heroPos: hero.group.position.toArray(),
        pet1Clip: pets[0]?.activeClip,
        pet2Clip: pets[1]?.activeClip,
        pet2Model: pets[1]?.modelFile,
        enemiesAlive: enemies.filter((e) => e.state !== 'dead').length,
        enemiesKilled: enemiesKilledInWave,
        chestState,
        loadedMediumClipsCount: masterClips.size,
      }),
      meleeAttack: () => triggerHeroMeleeAttack(),
      castAoe: () => {
        hero.aoeCooldown = 0;
        triggerHeroAoeSkill();
      },
      dodge: () => {
        hero.dodgeCooldown = 0;
        triggerHeroDodge();
      },
      spawnWave: () => spawnSkeletonWave(),
      openChestDemo: () => {
        for (const e of enemies) {
          if (e.state !== 'dead') damageEnemy(e, 999, 'AOE');
        }
      },
      setCameraMode: (mode: 'combat' | 'overview' | 'closeup') => {
        cameraMode = mode;
      },
      toggleHud: (visible: boolean) => toggleHudVisibility(visible),
      setMoveKeys: (keys: string[]) => {
        keysDown.clear();
        for (const k of keys) keysDown.add(k);
      },
    };

    // Start loop
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();
      updateHero(dt);
      updateCompanionPets(dt);
      updateEnemies(dt);
      updateProjectilesAndTelegraphs(dt);
      updateEnvironmentAndCamera(dt, elapsed);
      renderer.render(scene, camera);
    });
  } catch (err) {
    console.error('Failed to initialize KayKit 3D Combat Preview:', err);
    setLoadingText('Lỗi khi tải mô hình: ' + String(err));
  }
}

init();
