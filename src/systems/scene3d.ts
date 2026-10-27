import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  HABITAT_ZONES,
  HabitatZoneId,
  ParkSaveProfile,
  PlacedItem,
  RescuedAnimal,
  SPECIES_DATABASE,
  AnimalBehaviorState,
} from '../data/conservationData';
import {
  GATE_COORD,
  MAP_MAX_X,
  MAP_MAX_Z,
  MAP_MIN_X,
  MAP_MIN_Z,
  RESCUE_STATION_COORD,
  getCatalogItem,
  getZoneBounds,
  findGridPath,
  getPathCellSet,
  evaluateZoneWelfare,
} from './simulationCore';

export const TILE_SIZE = 2.0; // Each grid cell is 2.0m x 2.0m in 3D world space

export function gridToWorld(gx: number, gz: number): THREE.Vector3 {
  return new THREE.Vector3(gx * TILE_SIZE, 0, gz * TILE_SIZE);
}

export function worldToGrid(x: number, z: number): { gx: number; gz: number } {
  return {
    gx: Math.round(x / TILE_SIZE),
    gz: Math.round(z / TILE_SIZE),
  };
}

interface LoadedAssetCache {
  gltf: GLTF;
}

interface AnimalActor3D {
  animalId: string;
  modelUrl: string;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  currentClipName: string;
  position: THREE.Vector3;
  targetPosition: THREE.Vector3;
  moveTimer: number;
  behavior: AnimalBehaviorState;
  labelDiv: HTMLDivElement;
}

export interface VisitorAgent3D {
  id: string;
  name: string;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  walkAction?: THREE.AnimationAction;
  idleAction?: THREE.AnimationAction;
  waveAction?: THREE.AnimationAction;
  state: 'walking_to_view' | 'watching' | 'walking_to_exit';
  targetZoneId: HabitatZoneId;
  path: { x: number; z: number }[];
  pathIndex: number;
  watchTimer: number;
  educated: boolean;
  thoughtText: string;
  labelDiv: HTMLDivElement;
}

interface StaffKeeper3D {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  walkAction?: THREE.AnimationAction;
  idleAction?: THREE.AnimationAction;
  interactAction?: THREE.AnimationAction;
  position: THREE.Vector3;
  targetPosition: THREE.Vector3;
  state: 'patrol' | 'tending';
  timer: number;
  targetZoneId: HabitatZoneId;
  labelDiv: HTMLDivElement;
}

export class ZooScene3D {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private container: HTMLElement;
  private labelsContainer: HTMLElement;

  private loader = new GLTFLoader();
  private textureLoader = new THREE.TextureLoader();
  private assetCache = new Map<string, LoadedAssetCache>();
  private characterClips: THREE.AnimationClip[] = [];

  // Camera rig state (Isometric / Angled orbit + pan + zoom)
  private cameraTarget = new THREE.Vector3(0, 0, 2);
  private cameraDistance = 38;
  private cameraYaw = 0.45;
  private cameraPitch = 0.78;
  private isDraggingCamera = false;
  private dragStart = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist = 0;

  // Groups
  private worldGroup = new THREE.Group();
  private enclosuresGroup = new THREE.Group();
  private placedItemsGroup = new THREE.Group();
  private animalsGroup = new THREE.Group();
  private visitorsGroup = new THREE.Group();
  private previewGroup = new THREE.Group();
  private fxGroup = new THREE.Group();

  private groundPlane!: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();

  private animalActors = new Map<string, AnimalActor3D>();
  public visitors: VisitorAgent3D[] = [];
  private keeperActor: StaffKeeper3D | null = null;

  private hoverGrid = { gx: 0, gz: 0, valid: true };
  private onTileClickCallback?: (gx: number, gz: number) => void;
  private onAnimalClickCallback?: (animalId: string) => void;
  private onZoneViewingClickCallback?: (zoneId: HabitatZoneId) => void;
  private onHoverChangeCallback?: (gx: number, gz: number) => void;

  private activeParticles: {
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    life: number;
    maxLife: number;
  }[] = [];

  constructor(container: HTMLElement, labelsContainer: HTMLElement) {
    this.container = container;
    this.labelsContainer = labelsContainer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdbeafe);
    this.scene.fog = new THREE.FogExp2(0xdbeafe, 0.0085);

    this.camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.5,
      220
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.setupLights();
    this.setupBaseTerrain();

    this.scene.add(this.worldGroup);
    this.scene.add(this.enclosuresGroup);
    this.scene.add(this.placedItemsGroup);
    this.scene.add(this.animalsGroup);
    this.scene.add(this.visitorsGroup);
    this.scene.add(this.previewGroup);
    this.scene.add(this.fxGroup);

    this.updateCameraTransform();
    this.bindInputEvents();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xfef9c3, 0x4d7c0f, 0.85);
    hemi.position.set(0, 40, 0);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xfffbeb, 1.45);
    dir.position.set(26, 38, 22);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -36;
    dir.shadow.camera.right = 36;
    dir.shadow.camera.top = 36;
    dir.shadow.camera.bottom = -36;
    dir.shadow.camera.near = 2;
    dir.shadow.camera.far = 110;
    dir.shadow.bias = -0.0005;
    this.scene.add(dir);
  }

  private setupBaseTerrain(): void {
    const width = (MAP_MAX_X - MAP_MIN_X + 1) * TILE_SIZE;
    const depth = (MAP_MAX_Z - MAP_MIN_Z + 1) * TILE_SIZE;

    const geo = new THREE.PlaneGeometry(width + 16, depth + 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x84cc16,
      roughness: 0.92,
      metalness: 0.02,
    });
    this.groundPlane = new THREE.Mesh(geo, mat);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.receiveShadow = true;
    this.worldGroup.add(this.groundPlane);

    // Subtle grid helper for placement alignment
    const grid = new THREE.GridHelper(width, MAP_MAX_X - MAP_MIN_X + 1, 0x3f6212, 0x65a30d);
    grid.position.y = 0.02;
    (grid.material as THREE.Material).opacity = 0.22;
    (grid.material as THREE.Material).transparent = true;
    this.worldGroup.add(grid);
  }

  public async preloadCoreAssets(): Promise<void> {
    const urls = [
      '/assets/animals/Deer.glb',
      '/assets/animals/Stag.glb',
      '/assets/animals/Wolf.glb',
      '/assets/animals/Fox.glb',
      '/assets/nature/CommonTree_1.glb',
      '/assets/nature/PineTree_1.glb',
      '/assets/nature/BushBerries_1.glb',
      '/assets/nature/Lilypad.glb',
      '/assets/nature/WoodLog_Moss.glb',
      '/assets/nature/Rock_Moss_1.glb',
      '/assets/village/Fence.glb',
      '/assets/village/Stable.glb',
      '/assets/village/Hay.glb',
      '/assets/village/Path_Square.glb',
      '/assets/village/Well.glb',
      '/assets/village/Bench_1.glb',
      '/assets/village/MarketStand_1.glb',
      '/assets/village/Gazebo.glb',
      '/assets/village/House_1.glb',
      '/assets/characters/Ranger.glb',
      '/assets/characters/Mage.glb',
      '/assets/characters/Rogue.glb',
      '/assets/characters/Rig_Medium_MovementBasic.glb',
      '/assets/characters/Rig_Medium_General.glb',
      '/assets/characters/Rig_Medium_Simulation.glb',
    ];

    await Promise.all(
      urls.map(async (u) => {
        try {
          const gltf = await this.loader.loadAsync(u);
          this.assetCache.set(u, { gltf });
          if (u.includes('Rig_Medium_')) {
            for (const clip of gltf.animations) {
              this.characterClips.push(clip);
            }
          }
        } catch (err) {
          console.warn('Could not load asset:', u, err);
        }
      })
    );

    await this.buildFixedLandmarks();
  }

  private cloneModel(url: string, scale = 1.0): THREE.Group {
    const cached = this.assetCache.get(url);
    if (!cached) {
      const fallback = new THREE.Group();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x10b981 })
      );
      box.position.y = 0.5;
      fallback.add(box);
      return fallback;
    }
    const clone = SkeletonUtils.clone(cached.gltf.scene) as THREE.Group;
    clone.scale.setScalar(scale);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return clone;
  }

  private async buildFixedLandmarks(): Promise<void> {
    // 1. Ticket Gate at South (0, 11)
    const gatePos = gridToWorld(GATE_COORD.gx, GATE_COORD.gz);
    const gazebo = this.cloneModel('/assets/village/Gazebo.glb', 0.95);
    gazebo.position.copy(gatePos);
    this.worldGroup.add(gazebo);

    // Gate Arch Banner
    const gatePlatform = new THREE.Mesh(
      new THREE.BoxGeometry(TILE_SIZE * 3, 0.14, TILE_SIZE * 2),
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.8 })
    );
    gatePlatform.position.set(gatePos.x, 0.07, gatePos.z);
    gatePlatform.receiveShadow = true;
    this.worldGroup.add(gatePlatform);

    // 2. Rescue & Care Veterinary Station at North (0, -8)
    const stationPos = gridToWorld(RESCUE_STATION_COORD.gx, RESCUE_STATION_COORD.gz);
    const house = this.cloneModel('/assets/village/House_1.glb', 0.78);
    house.position.copy(stationPos);
    this.worldGroup.add(house);

    // Decorative background border trees outside map
    const borderTrees = [
      { x: -14, z: -9, url: '/assets/nature/PineTree_1.glb' },
      { x: -14, z: -3, url: '/assets/nature/CommonTree_1.glb' },
      { x: -14, z: 5, url: '/assets/nature/CommonTree_1.glb' },
      { x: 14, z: -8, url: '/assets/nature/PineTree_1.glb' },
      { x: 14, z: 0, url: '/assets/nature/PineTree_1.glb' },
      { x: 14, z: 7, url: '/assets/nature/CommonTree_1.glb' },
    ];
    for (const bt of borderTrees) {
      const t = this.cloneModel(bt.url, 1.1);
      t.position.copy(gridToWorld(bt.x, bt.z));
      this.worldGroup.add(t);
    }

    // Spawn Keeper Staff Member (KayKit Ranger)
    this.spawnStaffKeeper();
  }

  private spawnStaffKeeper(): void {
    const root = this.cloneModel('/assets/characters/Ranger.glb', 0.95);
    const pos = gridToWorld(0, -6);
    root.position.copy(pos);
    this.worldGroup.add(root);

    const mixer = new THREE.AnimationMixer(root);
    const walkClip = this.characterClips.find((c) => c.name === 'Walking_A');
    const idleClip = this.characterClips.find((c) => c.name === 'Idle_A');
    const interactClip = this.characterClips.find((c) => c.name === 'Interact');

    const walkAction = walkClip ? mixer.clipAction(walkClip) : undefined;
    const idleAction = idleClip ? mixer.clipAction(idleClip) : undefined;
    const interactAction = interactClip ? mixer.clipAction(interactClip) : undefined;

    if (idleAction) idleAction.play();

    const labelDiv = document.createElement('div');
    labelDiv.className = 'world-label keeper-label';
    labelDiv.innerHTML = `<span class="badge-keeper">🧑‍⚕️ Nhân viên Cứu hộ</span>`;
    this.labelsContainer.appendChild(labelDiv);

    this.keeperActor = {
      root,
      mixer,
      walkAction,
      idleAction,
      interactAction,
      position: pos.clone(),
      targetPosition: pos.clone(),
      state: 'patrol',
      timer: 2,
      targetZoneId: 'meadow_glade',
      labelDiv,
    };
  }

  public rebuildWorldFromProfile(profile: ParkSaveProfile): void {
    this.rebuildEnclosures(profile);
    this.rebuildPlacedItems(profile);
    this.syncAnimals(profile);
  }

  public rebuildEnclosures(profile: ParkSaveProfile): void {
    this.enclosuresGroup.clear();

    for (const zoneId of Object.keys(HABITAT_ZONES) as HabitatZoneId[]) {
      const zone = HABITAT_ZONES[zoneId];
      const built = !!profile.builtZones[zoneId];
      const bounds = getZoneBounds(zoneId);

      const widthWorld = zone.width * TILE_SIZE;
      const depthWorld = zone.depth * TILE_SIZE;
      const centerWorld = gridToWorld(zone.centerX - 0.5, zone.centerZ - 0.5);

      // Floor biome patch
      const floorGeo = new THREE.PlaneGeometry(widthWorld, depthWorld);
      const floorMat = new THREE.MeshStandardMaterial({
        color: built ? zone.groundColor : 0x9ca3af,
        roughness: 0.95,
        transparent: !built,
        opacity: built ? 1.0 : 0.45,
      });
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(centerWorld.x, 0.03, centerWorld.z);
      floorMesh.receiveShadow = true;
      this.enclosuresGroup.add(floorMesh);

      // Viewing point platform (safe observation distance outside fence)
      const viewWorld = gridToWorld(zone.viewingPoint.x, zone.viewingPoint.z);
      const viewPad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.05, 0.14, 16),
        new THREE.MeshStandardMaterial({
          color: built ? 0x0284c7 : 0x64748b,
          roughness: 0.6,
        })
      );
      viewPad.position.set(viewWorld.x, 0.07, viewWorld.z);
      viewPad.userData = { viewingZoneId: zoneId };
      this.enclosuresGroup.add(viewPad);

      if (!built) continue;

      // Perimeter wooden fences using Quaternius Fence.glb
      for (let gx = bounds.minX; gx <= bounds.maxX; gx++) {
        // North edge
        const fNorth = this.cloneModel('/assets/village/Fence.glb', 0.95);
        fNorth.position.copy(gridToWorld(gx, bounds.minZ - 0.5));
        this.enclosuresGroup.add(fNorth);

        // South edge
        const fSouth = this.cloneModel('/assets/village/Fence.glb', 0.95);
        fSouth.position.copy(gridToWorld(gx, bounds.maxZ + 0.5));
        this.enclosuresGroup.add(fSouth);
      }

      for (let gz = bounds.minZ; gz <= bounds.maxZ; gz++) {
        // West edge
        const fWest = this.cloneModel('/assets/village/Fence.glb', 0.95);
        fWest.position.copy(gridToWorld(bounds.minX - 0.5, gz));
        fWest.rotation.y = Math.PI / 2;
        this.enclosuresGroup.add(fWest);

        // East edge
        const fEast = this.cloneModel('/assets/village/Fence.glb', 0.95);
        fEast.position.copy(gridToWorld(bounds.maxX + 0.5, gz));
        fEast.rotation.y = Math.PI / 2;
        this.enclosuresGroup.add(fEast);
      }
    }
  }

  public rebuildPlacedItems(profile: ParkSaveProfile): void {
    this.placedItemsGroup.clear();

    for (const item of profile.placedItems) {
      const cat = getCatalogItem(item.catalogId);
      if (!cat) continue;

      const group = new THREE.Group();
      const offsetX = ((cat.footprintW - 1) * TILE_SIZE) / 2;
      const offsetZ = ((cat.footprintD - 1) * TILE_SIZE) / 2;
      const basePos = gridToWorld(item.gx, item.gz);
      group.position.set(basePos.x + offsetX, 0, basePos.z + offsetZ);
      group.rotation.y = item.rotationY || 0;
      group.userData = { placedUid: item.uid, catalogId: item.catalogId };

      if (item.catalogId === 'path_stone') {
        const tileMesh = new THREE.Mesh(
          new THREE.BoxGeometry(TILE_SIZE * 0.92, 0.08, TILE_SIZE * 0.92),
          new THREE.MeshStandardMaterial({ color: 0xe7e5e4, roughness: 0.85 })
        );
        tileMesh.position.y = 0.04;
        tileMesh.receiveShadow = true;
        group.add(tileMesh);
      } else if (item.catalogId === 'pond_natural') {
        const waterDisc = new THREE.Mesh(
          new THREE.CylinderGeometry(TILE_SIZE * 0.88, TILE_SIZE * 0.92, 0.1, 24),
          new THREE.MeshStandardMaterial({
            color: 0x0ea5e9,
            roughness: 0.2,
            metalness: 0.1,
          })
        );
        waterDisc.position.y = 0.05;
        waterDisc.receiveShadow = true;
        group.add(waterDisc);

        const lily = this.cloneModel(cat.modelPath, cat.scale);
        lily.position.y = 0.1;
        group.add(lily);
      } else if (item.catalogId === 'edu_signboard') {
        // Educational wooden stand with blue conservation board
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.12, 1.4, 8),
          new THREE.MeshStandardMaterial({ color: 0x78350f })
        );
        post.position.y = 0.7;
        group.add(post);

        const board = new THREE.Mesh(
          new THREE.BoxGeometry(1.3, 0.85, 0.14),
          new THREE.MeshStandardMaterial({ color: 0x0369a1 })
        );
        board.position.y = 1.35;
        group.add(board);
      } else {
        const model = this.cloneModel(cat.modelPath, cat.scale);
        group.add(model);
      }

      this.placedItemsGroup.add(group);
    }
  }

  public updatePlacementPreview(
    catalogId: string | null,
    gx: number,
    gz: number,
    valid: boolean,
    rotationY = 0
  ): void {
    this.previewGroup.clear();
    if (!catalogId) return;

    const cat = getCatalogItem(catalogId);
    if (!cat) return;

    const offsetX = ((cat.footprintW - 1) * TILE_SIZE) / 2;
    const offsetZ = ((cat.footprintD - 1) * TILE_SIZE) / 2;
    const pos = gridToWorld(gx, gz);

    const highlightBox = new THREE.Mesh(
      new THREE.BoxGeometry(cat.footprintW * TILE_SIZE * 0.96, 0.25, cat.footprintD * TILE_SIZE * 0.96),
      new THREE.MeshBasicMaterial({
        color: valid ? 0x22c55e : 0xef4444,
        transparent: true,
        opacity: 0.45,
      })
    );
    highlightBox.position.set(pos.x + offsetX, 0.13, pos.z + offsetZ);
    this.previewGroup.add(highlightBox);

    const ghostModel = this.cloneModel(cat.modelPath, cat.scale);
    ghostModel.position.set(pos.x + offsetX, 0.05, pos.z + offsetZ);
    ghostModel.rotation.y = rotationY;
    ghostModel.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        const m = c as THREE.Mesh;
        m.material = new THREE.MeshBasicMaterial({
          color: valid ? 0x4ade80 : 0xf87171,
          wireframe: true,
        });
      }
    });
    this.previewGroup.add(ghostModel);
  }

  public syncAnimals(profile: ParkSaveProfile): void {
    const activeIds = new Set(profile.animals.map((a) => a.id));

    // Remove animals no longer in park (e.g., released to wild)
    for (const [id, actor] of this.animalActors.entries()) {
      if (!activeIds.has(id)) {
        this.animalsGroup.remove(actor.root);
        actor.labelDiv.remove();
        this.animalActors.delete(id);
      }
    }

    // Add or update existing animals
    for (const animal of profile.animals) {
      const species = SPECIES_DATABASE[animal.speciesId];
      const desiredUrl =
        animal.stage === 'adult_ready'
          ? species.modelFiles!.adult
          : species.modelFiles!.juvenile;

      let actor = this.animalActors.get(animal.id);
      if (actor && actor.modelUrl !== desiredUrl) {
        // Model upgraded (e.g. Deer.glb -> Stag.glb when reaching adult stage)
        this.animalsGroup.remove(actor.root);
        actor.labelDiv.remove();
        this.animalActors.delete(animal.id);
        actor = undefined;
      }

      if (!actor) {
        actor = this.createAnimalActor(animal, desiredUrl);
        this.animalActors.set(animal.id, actor);
      }

      // Scale by growth stage (explicitly documented prototype limitation)
      const stageScale =
        animal.stage === 'juvenile_rescue'
          ? 0.72
          : animal.stage === 'rehab_subadult'
          ? 0.86
          : 1.0;
      actor.root.scale.setScalar(stageScale);
    }
  }

  private createAnimalActor(animal: RescuedAnimal, modelUrl: string): AnimalActor3D {
    const cached = this.assetCache.get(modelUrl);
    const root = this.cloneModel(modelUrl, 1.0);
    root.userData = { animalId: animal.id };
    root.traverse((c) => {
      c.userData = { animalId: animal.id };
    });

    const bounds = getZoneBounds(animal.zoneId);
    const startGx = (bounds.minX + bounds.maxX) / 2 + (Math.random() - 0.5) * 2;
    const startGz = (bounds.minZ + bounds.maxZ) / 2 + (Math.random() - 0.5) * 2;
    const startPos = gridToWorld(startGx, startGz);
    root.position.copy(startPos);
    this.animalsGroup.add(root);

    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    if (cached) {
      for (const clip of cached.gltf.animations) {
        actions.set(clip.name, mixer.clipAction(clip));
      }
    }

    const labelDiv = document.createElement('div');
    labelDiv.className = 'world-label animal-label';
    labelDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onAnimalClickCallback?.(animal.id);
    });
    this.labelsContainer.appendChild(labelDiv);

    const actor: AnimalActor3D = {
      animalId: animal.id,
      modelUrl,
      root,
      mixer,
      actions,
      currentClipName: '',
      position: startPos.clone(),
      targetPosition: startPos.clone(),
      moveTimer: 1.5,
      behavior: animal.currentBehavior || 'Idle',
      labelDiv,
    };

    this.playAnimalBehaviorClip(actor, 'Idle');
    return actor;
  }

  private playAnimalBehaviorClip(actor: AnimalActor3D, behavior: AnimalBehaviorState): void {
    actor.behavior = behavior;
    let candidates: string[] = [];
    if (behavior === 'Eating') {
      candidates = ['AnimalArmature|Eating'];
    } else if (behavior === 'Running') {
      candidates = ['AnimalArmature|Gallop', 'AnimalArmature|Walk'];
    } else if (behavior === 'Walking') {
      candidates = ['AnimalArmature|Walk'];
    } else if (behavior === 'Resting') {
      candidates = ['AnimalArmature|Idle_Headlow', 'AnimalArmature|Idle_2_HeadLow', 'AnimalArmature|Idle_2'];
    } else {
      candidates = ['AnimalArmature|Idle', 'AnimalArmature|Idle_2'];
    }

    let chosenName = '';
    for (const c of candidates) {
      if (actor.actions.has(c)) {
        chosenName = c;
        break;
      }
    }
    if (!chosenName && actor.actions.size > 0) {
      chosenName = Array.from(actor.actions.keys())[0];
    }
    if (!chosenName || chosenName === actor.currentClipName) return;

    const prev = actor.actions.get(actor.currentClipName);
    const next = actor.actions.get(chosenName);
    if (next) {
      next.reset().fadeIn(0.25).play();
      if (prev) prev.fadeOut(0.25);
      actor.currentClipName = chosenName;
    }
  }

  public triggerReleaseEffect(animal: RescuedAnimal): void {
    const actor = this.animalActors.get(animal.id);
    const origin = actor
      ? actor.position.clone()
      : gridToWorld(HABITAT_ZONES[animal.zoneId].centerX, HABITAT_ZONES[animal.zoneId].centerZ);

    for (let i = 0; i < 28; i++) {
      const pMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 8),
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0x34d399 : 0xfde047,
          transparent: true,
          opacity: 0.95,
        })
      );
      pMesh.position.copy(origin).add(new THREE.Vector3(0, 0.8, 0));
      this.fxGroup.add(pMesh);
      const angle = (i / 28) * Math.PI * 2;
      const speed = 2.0 + Math.random() * 2.5;
      this.activeParticles.push({
        mesh: pMesh,
        vel: new THREE.Vector3(Math.cos(angle) * speed, 2.5 + Math.random() * 2.5, Math.sin(angle) * speed),
        life: 0,
        maxLife: 1.8,
      });
    }
  }

  public spawnVisitor(profile: ParkSaveProfile, targetZoneId: HabitatZoneId): boolean {
    if (this.visitors.length >= 8) return false;
    const zone = HABITAT_ZONES[targetZoneId];
    if (!profile.builtZones[targetZoneId]) return false;

    const pathCells = getPathCellSet(profile);
    const route = findGridPath(pathCells, { x: GATE_COORD.gx, z: GATE_COORD.gz }, zone.viewingPoint);
    if (!route || route.length < 2) return false;

    const visitorModels = ['/assets/characters/Mage.glb', '/assets/characters/Rogue.glb'];
    const modelUrl = visitorModels[Math.floor(Math.random() * visitorModels.length)];
    const root = this.cloneModel(modelUrl, 0.9);
    const startWorld = gridToWorld(GATE_COORD.gx, GATE_COORD.gz);
    root.position.copy(startWorld);
    this.visitorsGroup.add(root);

    const mixer = new THREE.AnimationMixer(root);
    const walkClip = this.characterClips.find((c) => c.name === 'Walking_A');
    const idleClip = this.characterClips.find((c) => c.name === 'Idle_A');
    const waveClip = this.characterClips.find((c) => c.name === 'Cheering' || c.name === 'Waving');

    const walkAction = walkClip ? mixer.clipAction(walkClip) : undefined;
    const idleAction = idleClip ? mixer.clipAction(idleClip) : undefined;
    const waveAction = waveClip ? mixer.clipAction(waveClip) : undefined;
    if (walkAction) walkAction.play();

    const names = ['Khách Minh Anh', 'Khách Hoàng Nam', 'Khách Thu Hà', 'Khách Quốc Bảo', 'Khách Thanh Trúc'];
    const name = names[Math.floor(Math.random() * names.length)];

    const labelDiv = document.createElement('div');
    labelDiv.className = 'world-label visitor-label';
    this.labelsContainer.appendChild(labelDiv);

    this.visitors.push({
      id: 'vis_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      name,
      root,
      mixer,
      walkAction,
      idleAction,
      waveAction,
      state: 'walking_to_view',
      targetZoneId,
      path: route,
      pathIndex: 0,
      watchTimer: 5.5,
      educated: false,
      thoughtText: `🎟️ Mua vé +${profile.ticketPrice}đ`,
      labelDiv,
    });
    return true;
  }

  public stepFrame(
    dt: number,
    profile: ParkSaveProfile,
    onVisitorCompleted?: (educated: boolean, satisfaction: number) => void
  ): void {
    // 1. Update animals (stay inside fence bounds, avoid obstacles/ponds, avoid overlapping each other)
    const allAnimalActors = Array.from(this.animalActors.values());

    for (const animal of profile.animals) {
      const actor = this.animalActors.get(animal.id);
      if (!actor) continue;
      actor.mixer.update(dt);

      const bounds = getZoneBounds(animal.zoneId);
      const minWorldX = (bounds.minX + 0.4) * TILE_SIZE;
      const maxWorldX = (bounds.maxX - 0.4) * TILE_SIZE;
      const minWorldZ = (bounds.minZ + 0.4) * TILE_SIZE;
      const maxWorldZ = (bounds.maxZ - 0.4) * TILE_SIZE;

      actor.moveTimer -= dt;
      if (actor.moveTimer <= 0) {
        // Decide next behavior based on hunger, health, comfort, and nearby items
        if (animal.hunger < 62) {
          // Find feeder in zone
          const feeder = profile.placedItems.find(
            (i) =>
              i.catalogId === 'feeder_hay' &&
              i.gx >= bounds.minX &&
              i.gx <= bounds.maxX &&
              i.gz >= bounds.minZ &&
              i.gz <= bounds.maxZ
          );
          if (feeder) {
            actor.targetPosition.copy(gridToWorld(feeder.gx, feeder.gz));
          }
          animal.currentBehavior = 'Eating';
          actor.moveTimer = 3.5;
        } else if (animal.health < 60 || animal.comfort < 55) {
          // Rest near shelter
          const shelter = profile.placedItems.find(
            (i) =>
              i.catalogId === 'shelter_stable' &&
              i.gx >= bounds.minX &&
              i.gx <= bounds.maxX &&
              i.gz >= bounds.minZ &&
              i.gz <= bounds.maxZ
          );
          if (shelter) {
            actor.targetPosition.copy(gridToWorld(shelter.gx + 0.5, shelter.gz + 0.5));
          }
          animal.currentBehavior = 'Resting';
          actor.moveTimer = 4.0;
        } else {
          // Pick a safe point inside enclosure not overlapping a pond or rock
          let candX = minWorldX + Math.random() * (maxWorldX - minWorldX);
          let candZ = minWorldZ + Math.random() * (maxWorldZ - minWorldZ);
          for (let attempt = 0; attempt < 6; attempt++) {
            const g = worldToGrid(candX, candZ);
            const blockedByPondOrRock = profile.placedItems.some(
              (it) =>
                (it.catalogId === 'pond_natural' || it.catalogId === 'rock_boulder') &&
                Math.abs(it.gx - g.gx) <= 1 &&
                Math.abs(it.gz - g.gz) <= 1
            );
            if (!blockedByPondOrRock) break;
            candX = minWorldX + Math.random() * (maxWorldX - minWorldX);
            candZ = minWorldZ + Math.random() * (maxWorldZ - minWorldZ);
          }
          actor.targetPosition.set(candX, 0, candZ);
          animal.currentBehavior =
            animal.comfort >= 80 && Math.random() < 0.45 ? 'Running' : Math.random() < 0.7 ? 'Walking' : 'Idle';
          actor.moveTimer = 3.2 + Math.random() * 2.5;
        }
      }

      // Move towards target if walking/running/going to feeder
      const toTarget = actor.targetPosition.clone().sub(actor.position);
      toTarget.y = 0;
      const dist = toTarget.length();

      if (dist > 0.35 && (animal.currentBehavior === 'Walking' || animal.currentBehavior === 'Running')) {
        const speed = animal.currentBehavior === 'Running' ? 2.6 : 1.35;
        const step = toTarget.normalize().multiplyScalar(Math.min(dist, speed * dt));
        actor.position.add(step);
        const targetAngle = Math.atan2(toTarget.x, toTarget.z);
        actor.root.rotation.y = targetAngle;
        this.playAnimalBehaviorClip(actor, animal.currentBehavior);
      } else {
        // Reached target or stationary state
        const stationaryState: AnimalBehaviorState =
          animal.currentBehavior === 'Eating'
            ? 'Eating'
            : animal.currentBehavior === 'Resting'
            ? 'Resting'
            : 'Idle';
        this.playAnimalBehaviorClip(actor, stationaryState);
      }

      // Separation force so animals never overlap each other
      for (const other of allAnimalActors) {
        if (other.animalId === actor.animalId) continue;
        const diff = actor.position.clone().sub(other.position);
        diff.y = 0;
        const d = diff.length();
        if (d > 0.001 && d < 1.65) {
          actor.position.add(diff.normalize().multiplyScalar((1.65 - d) * 2.5 * dt));
        }
      }

      // Clamp strictly inside fence bounds
      actor.position.x = Math.max(minWorldX, Math.min(maxWorldX, actor.position.x));
      actor.position.z = Math.max(minWorldZ, Math.min(maxWorldZ, actor.position.z));
      actor.root.position.copy(actor.position);

      // Update floating HTML label
      const behaviorVi: Record<AnimalBehaviorState, string> = {
        Idle: 'Đang quan sát',
        Walking: 'Đang dạo bước',
        Running: 'Chạy nhảy khỏe mạnh',
        Eating: 'Đang ăn uống',
        Resting: 'Đang nghỉ (Hạ đầu)',
      };
      actor.labelDiv.innerHTML = `
        <div class="animal-tag">
          <strong>${animal.name}</strong> <small>(${animal.code})</small><br/>
          <span>❤️ ${Math.round(animal.health)}% | 🌿 ${Math.round(animal.comfort)}% | 🎯 Phục hồi ${Math.round(animal.rehabProgress)}%</span><br/>
          <em>${behaviorVi[actor.behavior]}</em>
        </div>
      `;
      this.projectLabel(actor.position.clone().add(new THREE.Vector3(0, 2.2, 0)), actor.labelDiv);
    }

    // 2. Update Staff Keeper
    if (this.keeperActor) {
      const k = this.keeperActor;
      k.mixer.update(dt);
      k.timer -= dt;
      if (k.timer <= 0) {
        const builtZones = (Object.keys(HABITAT_ZONES) as HabitatZoneId[]).filter(
          (z) => profile.builtZones[z]
        );
        if (builtZones.length > 0) {
          const nextZ = builtZones[Math.floor(Math.random() * builtZones.length)];
          k.targetZoneId = nextZ;
          const gatePt = HABITAT_ZONES[nextZ].keeperGatePoint;
          k.targetPosition.copy(gridToWorld(gatePt.x, gatePt.z));
          k.timer = 6.5;
        }
      }

      const diff = k.targetPosition.clone().sub(k.position);
      diff.y = 0;
      if (diff.length() > 0.25) {
        const dir = diff.clone().normalize();
        k.position.add(dir.multiplyScalar(Math.min(diff.length(), 2.2 * dt)));
        k.root.position.copy(k.position);
        k.root.rotation.y = Math.atan2(dir.x, dir.z);
        if (k.walkAction && !k.walkAction.isRunning()) {
          k.idleAction?.fadeOut(0.2);
          k.walkAction.reset().fadeIn(0.2).play();
        }
      } else {
        if (k.idleAction && !k.idleAction.isRunning()) {
          k.walkAction?.fadeOut(0.2);
          k.idleAction.reset().fadeIn(0.2).play();
        }
      }
      this.projectLabel(k.position.clone().add(new THREE.Vector3(0, 2.3, 0)), k.labelDiv);
    }

    // 3. Update Visitors along stone path network
    for (let i = this.visitors.length - 1; i >= 0; i--) {
      const v = this.visitors[i];
      v.mixer.update(dt);

      if (v.state === 'walking_to_view' || v.state === 'walking_to_exit') {
        const targetCell = v.path[v.pathIndex];
        if (!targetCell) {
          if (v.state === 'walking_to_view') {
            v.state = 'watching';
            v.watchTimer = 5.0;
            v.walkAction?.fadeOut(0.2);
            v.idleAction?.reset().fadeIn(0.2).play();
            const welfare = evaluateZoneWelfare(profile, v.targetZoneId);
            const species = SPECIES_DATABASE[HABITAT_ZONES[v.targetZoneId].speciesId];
            if (welfare.hasEducationSign) {
              v.educated = true;
              v.thoughtText = `📖 Đọc biển bảo tồn ${species.vietnameseName} (+Uy tín)`;
            } else {
              v.thoughtText = `👀 Ngắm ${species.vietnameseName} từ khoảng cách an toàn`;
            }
          } else {
            // Reached exit gate
            const welfare = evaluateZoneWelfare(profile, v.targetZoneId);
            const sat = Math.min(100, Math.round(welfare.overallComfort * 0.7 + (v.educated ? 25 : 10)));
            onVisitorCompleted?.(v.educated, sat);
            this.visitorsGroup.remove(v.root);
            v.labelDiv.remove();
            this.visitors.splice(i, 1);
            continue;
          }
        } else {
          const targetWorld = gridToWorld(targetCell.x, targetCell.z);
          const diff = targetWorld.clone().sub(v.root.position);
          diff.y = 0;
          if (diff.length() < 0.2) {
            v.pathIndex++;
          } else {
            const dir = diff.normalize();
            v.root.position.add(dir.multiplyScalar(2.3 * dt));
            v.root.rotation.y = Math.atan2(dir.x, dir.z);
          }
        }
      } else if (v.state === 'watching') {
        v.watchTimer -= dt;
        const zCenter = gridToWorld(
          HABITAT_ZONES[v.targetZoneId].centerX,
          HABITAT_ZONES[v.targetZoneId].centerZ
        );
        const lookDir = zCenter.sub(v.root.position);
        v.root.rotation.y = Math.atan2(lookDir.x, lookDir.z);

        if (v.watchTimer <= 0) {
          v.state = 'walking_to_exit';
          v.path = [...v.path].reverse();
          v.pathIndex = 0;
          v.thoughtText = v.educated
            ? '💚 Hiểu thêm về bảo tồn! Đang ra về'
            : '🙂 Tham quan xong, đang ra về';
          v.idleAction?.fadeOut(0.2);
          v.walkAction?.reset().fadeIn(0.2).play();
        }
      }

      v.labelDiv.innerHTML = `<div class="visitor-tag"><strong>${v.name}</strong><br/><span>${v.thoughtText}</span></div>`;
      this.projectLabel(v.root.position.clone().add(new THREE.Vector3(0, 2.2, 0)), v.labelDiv);
    }

    // 4. Update release particles
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.fxGroup.remove(p.mesh);
        this.activeParticles.splice(i, 1);
      } else {
        p.mesh.position.addScaledVector(p.vel, dt);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p.life / p.maxLife;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  private projectLabel(worldPos: THREE.Vector3, el: HTMLDivElement): void {
    const projected = worldPos.clone().project(this.camera);
    if (projected.z > 1) {
      el.style.display = 'none';
      return;
    }
    const x = (projected.x * 0.5 + 0.5) * this.container.clientWidth;
    const y = (-projected.y * 0.5 + 0.5) * this.container.clientHeight;
    el.style.display = 'block';
    el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  public resetCamera(): void {
    this.cameraTarget.set(0, 0, 2);
    this.cameraDistance = 38;
    this.cameraYaw = 0.45;
    this.cameraPitch = 0.78;
    this.updateCameraTransform();
  }

  public focusOnZone(zoneId: HabitatZoneId): void {
    const z = HABITAT_ZONES[zoneId];
    const w = gridToWorld(z.centerX, z.centerZ);
    this.cameraTarget.set(w.x, 0, w.z);
    this.cameraDistance = 26;
    this.updateCameraTransform();
  }

  public zoomBy(delta: number): void {
    this.cameraDistance = Math.max(14, Math.min(64, this.cameraDistance + delta));
    this.updateCameraTransform();
  }

  private updateCameraTransform(): void {
    const x =
      this.cameraTarget.x +
      this.cameraDistance * Math.cos(this.cameraPitch) * Math.sin(this.cameraYaw);
    const y = this.cameraTarget.y + this.cameraDistance * Math.sin(this.cameraPitch);
    const z =
      this.cameraTarget.z +
      this.cameraDistance * Math.cos(this.cameraPitch) * Math.cos(this.cameraYaw);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.cameraTarget);
  }

  public setInteractionCallbacks(callbacks: {
    onTileClick: (gx: number, gz: number) => void;
    onAnimalClick: (animalId: string) => void;
    onZoneViewingClick: (zoneId: HabitatZoneId) => void;
    onHoverChange: (gx: number, gz: number) => void;
  }): void {
    this.onTileClickCallback = callbacks.onTileClick;
    this.onAnimalClickCallback = callbacks.onAnimalClick;
    this.onZoneViewingClickCallback = callbacks.onZoneViewingClick;
    this.onHoverChangeCallback = callbacks.onHoverChange;
  }

  private bindInputEvents(): void {
    const dom = this.renderer.domElement;
    let pointerDownPos = { x: 0, y: 0 };

    dom.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pointerDownPos = { x: e.clientX, y: e.clientY };
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.isDraggingCamera = false;

      if (this.pointers.size === 2) {
        const pts = Array.from(this.pointers.values());
        this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    });

    dom.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (this.pointers.size === 2) {
        const pts = Array.from(this.pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.lastPinchDist > 0) {
          const diff = this.lastPinchDist - dist;
          this.zoomBy(diff * 0.08);
        }
        this.lastPinchDist = dist;
        this.isDraggingCamera = true;
        return;
      }

      if (this.pointers.size === 1) {
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 6) {
          this.isDraggingCamera = true;
        }
        if (this.isDraggingCamera) {
          if (e.buttons === 2 || e.shiftKey) {
            this.cameraYaw -= dx * 0.007;
            this.cameraPitch = Math.max(0.35, Math.min(1.35, this.cameraPitch + dy * 0.006));
          } else {
            const panSpeed = this.cameraDistance * 0.0014;
            const forward = new THREE.Vector3(
              -Math.sin(this.cameraYaw),
              0,
              -Math.cos(this.cameraYaw)
            );
            const right = new THREE.Vector3(
              Math.cos(this.cameraYaw),
              0,
              -Math.sin(this.cameraYaw)
            );
            this.cameraTarget.addScaledVector(right, -dx * panSpeed);
            this.cameraTarget.addScaledVector(forward, dy * panSpeed);
            this.cameraTarget.x = Math.max(-24, Math.min(24, this.cameraTarget.x));
            this.cameraTarget.z = Math.max(-22, Math.min(24, this.cameraTarget.z));
          }
          this.dragStart = { x: e.clientX, y: e.clientY };
          this.updateCameraTransform();
          return;
        }
      }

      // Raycast ground for hover coordinates
      const hit = this.raycastGround(e.clientX, e.clientY);
      if (hit) {
        const g = worldToGrid(hit.x, hit.z);
        if (g.gx !== this.hoverGrid.gx || g.gz !== this.hoverGrid.gz) {
          this.hoverGrid.gx = g.gx;
          this.hoverGrid.gz = g.gz;
          this.onHoverChangeCallback?.(g.gx, g.gz);
        }
      }
    });

    const clearPointer = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.lastPinchDist = 0;
    };

    dom.addEventListener('pointerup', (e) => {
      const wasDragging = this.isDraggingCamera;
      clearPointer(e);
      if (wasDragging) return;

      const rect = dom.getBoundingClientRect();
      this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);

      // 1. Check click on animal
      const animalHits = this.raycaster.intersectObjects(this.animalsGroup.children, true);
      if (animalHits.length > 0) {
        let obj: THREE.Object3D | null = animalHits[0].object;
        while (obj) {
          if (obj.userData?.animalId) {
            this.onAnimalClickCallback?.(obj.userData.animalId);
            return;
          }
          obj = obj.parent;
        }
      }

      // 2. Check click on viewing point pad
      const viewHits = this.raycaster.intersectObjects(this.enclosuresGroup.children, true);
      for (const h of viewHits) {
        if (h.object.userData?.viewingZoneId) {
          this.onZoneViewingClickCallback?.(h.object.userData.viewingZoneId);
          return;
        }
      }

      // 3. Ground tile click
      const groundHit = this.raycastGround(e.clientX, e.clientY);
      if (groundHit) {
        const g = worldToGrid(groundHit.x, groundHit.z);
        this.onTileClickCallback?.(g.gx, g.gz);
      }
    });

    dom.addEventListener('pointercancel', clearPointer);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(e.deltaY * 0.02);
      },
      { passive: false }
    );

    window.addEventListener('resize', () => {
      this.camera.aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    });
  }

  private raycastGround(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.groundPlane, false);
    return hits.length > 0 ? hits[0].point : null;
  }
}
