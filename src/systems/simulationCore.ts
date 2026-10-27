import {
  HABITAT_ZONES,
  HabitatZoneId,
  PLACEABLE_CATALOG,
  PlaceableCatalogItem,
  PlacedItem,
  ParkSaveProfile,
  SPECIES_DATABASE,
  RescuedAnimal,
} from '../data/conservationData';

export const MAP_MIN_X = -13;
export const MAP_MAX_X = 13;
export const MAP_MIN_Z = -11;
export const MAP_MAX_Z = 12;

export const GATE_COORD = { gx: 0, gz: 11 };
export const RESCUE_STATION_COORD = { gx: 0, gz: -8 };

export interface ZoneWelfareMetrics {
  zoneId: HabitatZoneId;
  built: boolean;
  treesCount: number;
  waterCount: number;
  shelterCount: number;
  enrichmentCount: number;
  feederCount: number;
  quietnessScore: number; // 0..100
  spaceScore: number;     // 0..100 (penalizes crowding)
  overallComfort: number; // 0..100
  keeperAccessible: boolean;
  visitorViewingConnected: boolean;
  hasEducationSign: boolean;
  animalCount: number;
  missingNotes: string[];
}

export function getCatalogItem(catalogId: string): PlaceableCatalogItem | undefined {
  return PLACEABLE_CATALOG.find((c) => c.id === catalogId);
}

export function getZoneBounds(zoneId: HabitatZoneId): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const z = HABITAT_ZONES[zoneId];
  const halfW = Math.floor(z.width / 2);
  const halfD = Math.floor(z.depth / 2);
  return {
    minX: z.centerX - halfW,
    maxX: z.centerX + halfW - 1,
    minZ: z.centerZ - halfD,
    maxZ: z.centerZ + halfD - 1,
  };
}

export function getZoneAtCell(gx: number, gz: number): HabitatZoneId | null {
  for (const zoneId of Object.keys(HABITAT_ZONES) as HabitatZoneId[]) {
    const b = getZoneBounds(zoneId);
    if (gx >= b.minX && gx <= b.maxX && gz >= b.minZ && gz <= b.maxZ) {
      return zoneId;
    }
  }
  return null;
}

export function isFixedLandmarkCell(gx: number, gz: number): boolean {
  // Ticket Gate at (0, 11) & (-1..1, 11..12)
  if (gx >= -1 && gx <= 1 && gz >= 11 && gz <= 12) return true;
  // Rescue & Vet Station at (-1..1, -9..-7)
  if (gx >= -1 && gx <= 1 && gz >= -9 && gz <= -7) return true;
  return false;
}

export function isEnclosureFencePerimeterCell(gx: number, gz: number): boolean {
  for (const zoneId of Object.keys(HABITAT_ZONES) as HabitatZoneId[]) {
    const b = getZoneBounds(zoneId);
    const onOuterRing =
      gx >= b.minX - 1 &&
      gx <= b.maxX + 1 &&
      gz >= b.minZ - 1 &&
      gz <= b.maxZ + 1 &&
      (gx === b.minX - 1 || gx === b.maxX + 1 || gz === b.minZ - 1 || gz === b.maxZ + 1);
    if (onOuterRing) {
      // Allow viewing point and keeper gate point to have paths/signs next to them
      const z = HABITAT_ZONES[zoneId];
      if (gx === z.viewingPoint.x && gz === z.viewingPoint.z) return false;
      if (gx === z.keeperGatePoint.x && gz === z.keeperGatePoint.z) return false;
      return true;
    }
  }
  return false;
}

export function getItemOccupiedCells(
  gx: number,
  gz: number,
  footprintW: number,
  footprintD: number
): { x: number; z: number }[] {
  const cells: { x: number; z: number }[] = [];
  for (let dx = 0; dx < footprintW; dx++) {
    for (let dz = 0; dz < footprintD; dz++) {
      cells.push({ x: gx + dx, z: gz + dz });
    }
  }
  return cells;
}

export interface PlacementValidationResult {
  valid: boolean;
  reason?: string;
}

export function validatePlacement(
  profile: ParkSaveProfile,
  catalogItem: PlaceableCatalogItem,
  gx: number,
  gz: number,
  ignoreUid?: string
): PlacementValidationResult {
  const cells = getItemOccupiedCells(gx, gz, catalogItem.footprintW, catalogItem.footprintD);

  // 1. Check map bounds
  for (const c of cells) {
    if (c.x < MAP_MIN_X || c.x > MAP_MAX_X || c.z < MAP_MIN_Z || c.z > MAP_MAX_Z) {
      return { valid: false, reason: 'Ngoài phạm vi bản đồ vườn.' };
    }
    if (isFixedLandmarkCell(c.x, c.z)) {
      return { valid: false, reason: 'Không thể đặt đè lên Cổng Bán Vé hoặc Trạm Cứu Hộ.' };
    }
    if (isEnclosureFencePerimeterCell(c.x, c.z)) {
      return { valid: false, reason: 'Không thể đặt đè lên vành đai hàng rào bảo vệ khu nuôi.' };
    }
  }

  // 2. Check habitat zone rules (Visitor items must be outside enclosures; animal care items inside built enclosures)
  const visitorOnlyCategories = ['path', 'viewing_sign', 'bench', 'service_kiosk'];
  const enclosurePreferredCategories = ['pond', 'shelter', 'feeder', 'enrichment'];

  for (const c of cells) {
    const zoneAtCell = getZoneAtCell(c.x, c.z);
    if (visitorOnlyCategories.includes(catalogItem.category) && zoneAtCell !== null) {
      return {
        valid: false,
        reason: 'Đường đi, ghế nghỉ và biển giáo dục của khách không được đặt bên trong khu nuôi thú.',
      };
    }
    if (enclosurePreferredCategories.includes(catalogItem.category)) {
      if (!zoneAtCell) {
        return {
          valid: false,
          reason: 'Hồ nước, chỗ trú, máng ăn và đồ làm giàu phải đặt bên trong một Khu Cứu Hộ.',
        };
      }
      if (!profile.builtZones[zoneAtCell]) {
        return {
          valid: false,
          reason: 'Khu cứu hộ này chưa được mở khóa/xây dựng.',
        };
      }
    }
  }

  // 3. Check overlap with existing placed items
  const occupiedSet = new Set<string>();
  for (const existing of profile.placedItems) {
    if (existing.uid === ignoreUid) continue;
    const cat = getCatalogItem(existing.catalogId);
    if (!cat) continue;
    for (const ec of getItemOccupiedCells(existing.gx, existing.gz, cat.footprintW, cat.footprintD)) {
      occupiedSet.add(`${ec.x},${ec.z}`);
    }
  }
  for (const c of cells) {
    if (occupiedSet.has(`${c.x},${c.z}`)) {
      return { valid: false, reason: 'Ô lưới đã có công trình hoặc cây cảnh khác.' };
    }
  }

  // 4. Prevent blocking the entrance gate or cutting off road connectivity when placing non-path obstacles outside zones
  if (catalogItem.category !== 'path') {
    for (const c of cells) {
      if (c.x === GATE_COORD.gx && c.z === GATE_COORD.gz - 1) {
        return { valid: false, reason: 'Không được chặn lối vào ngay trước Cổng Bán Vé.' };
      }
      for (const zId of Object.keys(HABITAT_ZONES) as HabitatZoneId[]) {
        const z = HABITAT_ZONES[zId];
        if (c.x === z.keeperGatePoint.x && c.z === z.keeperGatePoint.z) {
          return { valid: false, reason: 'Không được chặn cổng tiếp cận của nhân viên chăm sóc.' };
        }
      }
    }
  }

  return { valid: true };
}

export function getPathCellSet(profile: ParkSaveProfile): Set<string> {
  const set = new Set<string>();
  set.add(`${GATE_COORD.gx},${GATE_COORD.gz}`);
  set.add(`${RESCUE_STATION_COORD.gx},${RESCUE_STATION_COORD.gz}`);
  for (const item of profile.placedItems) {
    if (item.catalogId === 'path_stone') {
      set.add(`${item.gx},${item.gz}`);
    }
  }
  return set;
}

export function findGridPath(
  validCells: Set<string>,
  start: { x: number; z: number },
  goal: { x: number; z: number }
): { x: number; z: number }[] | null {
  const startKey = `${start.x},${start.z}`;
  const goalKey = `${goal.x},${goal.z}`;
  if (startKey === goalKey) return [start];

  const queue: { x: number; z: number }[] = [start];
  const cameFrom = new Map<string, string>();
  cameFrom.set(startKey, '');

  const dirs = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
  ];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currKey = `${curr.x},${curr.z}`;
    if (currKey === goalKey) {
      const path: { x: number; z: number }[] = [];
      let k = goalKey;
      while (k) {
        const [px, pz] = k.split(',').map(Number);
        path.unshift({ x: px, z: pz });
        k = cameFrom.get(k) || '';
      }
      return path;
    }

    for (const d of dirs) {
      const nx = curr.x + d.dx;
      const nz = curr.z + d.dz;
      const nKey = `${nx},${nz}`;
      if ((validCells.has(nKey) || nKey === goalKey) && !cameFrom.has(nKey)) {
        cameFrom.set(nKey, currKey);
        queue.push({ x: nx, z: nz });
      }
    }
  }
  return null;
}

export function evaluateZoneWelfare(
  profile: ParkSaveProfile,
  zoneId: HabitatZoneId
): ZoneWelfareMetrics {
  const zone = HABITAT_ZONES[zoneId];
  const built = !!profile.builtZones[zoneId];
  const bounds = getZoneBounds(zoneId);
  const species = SPECIES_DATABASE[zone.speciesId];
  const targets = species.simulationTargets || {
    minTrees: 2,
    minWater: 1,
    minShelter: 1,
    minEnrichment: 1,
    minQuietness: 60,
  };

  let treesCount = 0;
  let waterCount = 0;
  let shelterCount = 0;
  let enrichmentCount = 0;
  let feederCount = 0;
  let quietnessBonus = 50; // Base quietness with safe viewing distance buffer

  for (const item of profile.placedItems) {
    const cat = getCatalogItem(item.catalogId);
    if (!cat) continue;
    const inZone =
      item.gx >= bounds.minX &&
      item.gx <= bounds.maxX &&
      item.gz >= bounds.minZ &&
      item.gz <= bounds.maxZ;
    if (inZone) {
      if (cat.welfareBonus?.trees) treesCount += cat.welfareBonus.trees;
      if (cat.welfareBonus?.water) waterCount += cat.welfareBonus.water;
      if (cat.welfareBonus?.shelter) shelterCount += cat.welfareBonus.shelter;
      if (cat.welfareBonus?.enrichment) enrichmentCount += cat.welfareBonus.enrichment;
      if (cat.welfareBonus?.quietness) quietnessBonus += cat.welfareBonus.quietness;
      if (cat.category === 'feeder') feederCount += 1;
    }
  }

  const animalsInZone = profile.animals.filter((a) => a.zoneId === zoneId);
  const animalCount = animalsInZone.length;

  // Crowding penalty: never reward stuffing many animals in a small enclosure!
  const spaceScore = animalCount <= 2 ? 100 : Math.max(25, 100 - (animalCount - 2) * 30);
  const quietnessScore = Math.max(20, Math.min(100, quietnessBonus - Math.max(0, animalCount - 2) * 12));

  // Check path connectivity from Gate (0, 11) to viewingPoint and from Rescue Station (0, -7) to keeperGatePoint
  const pathCells = getPathCellSet(profile);
  // Also allow walking 1 step from any path cell to keeperGatePoint / viewingPoint
  const visitorPath = findGridPath(pathCells, { x: GATE_COORD.gx, z: GATE_COORD.gz }, zone.viewingPoint);
  const visitorViewingConnected = visitorPath !== null;

  // Keeper can walk along paths or grass corridor outside enclosures if unobstructed
  const blockedCells = new Set<string>();
  for (const item of profile.placedItems) {
    if (item.catalogId === 'path_stone') continue;
    const cat = getCatalogItem(item.catalogId);
    if (!cat) continue;
    for (const c of getItemOccupiedCells(item.gx, item.gz, cat.footprintW, cat.footprintD)) {
      blockedCells.add(`${c.x},${c.z}`);
    }
  }
  const walkableKeeperCells = new Set<string>();
  for (let x = MAP_MIN_X; x <= MAP_MAX_X; x++) {
    for (let z = MAP_MIN_Z; z <= MAP_MAX_Z; z++) {
      if (!blockedCells.has(`${x},${z}`) && getZoneAtCell(x, z) === null) {
        walkableKeeperCells.add(`${x},${z}`);
      }
    }
  }
  const keeperRoute = findGridPath(
    walkableKeeperCells,
    { x: 0, z: -6 },
    zone.keeperGatePoint
  );
  const keeperAccessible = keeperRoute !== null;

  // Check if an education signboard is within 2 tiles of viewingPoint
  const hasEducationSign = profile.placedItems.some(
    (item) =>
      item.catalogId === 'edu_signboard' &&
      Math.abs(item.gx - zone.viewingPoint.x) <= 2 &&
      Math.abs(item.gz - zone.viewingPoint.z) <= 2
  );

  const treeRatio = Math.min(1, treesCount / targets.minTrees);
  const waterRatio = Math.min(1, waterCount / targets.minWater);
  const shelterRatio = Math.min(1, shelterCount / targets.minShelter);
  const enrichRatio = Math.min(1, enrichmentCount / targets.minEnrichment);
  const quietRatio = Math.min(1, quietnessScore / targets.minQuietness);

  const rawComfort =
    (treeRatio * 22 +
      waterRatio * 22 +
      shelterRatio * 22 +
      enrichRatio * 14 +
      quietRatio * 10 +
      (spaceScore / 100) * 10);

  const overallComfort = built ? Math.round(Math.max(10, Math.min(100, rawComfort))) : 0;

  const missingNotes: string[] = [];
  if (!built) {
    missingNotes.push('Chưa xây dựng Khu Cứu Hộ này.');
  } else {
    if (treesCount < targets.minTrees) missingNotes.push(`Thiếu cây xanh (${treesCount}/${targets.minTrees})`);
    if (waterCount < targets.minWater) missingNotes.push(`Thiếu hồ nước sạch (${waterCount}/${targets.minWater})`);
    if (shelterCount < targets.minShelter) missingNotes.push(`Thiếu chỗ trú ẩn (${shelterCount}/${targets.minShelter})`);
    if (enrichmentCount < targets.minEnrichment) {
      missingNotes.push(`Cần thêm bụi quả/đồ làm giàu (${enrichmentCount}/${targets.minEnrichment})`);
    }
    if (feederCount < 1) missingNotes.push('Chưa có Điểm Cho Ăn Sinh Thái trong khu nuôi');
    if (!keeperAccessible) missingNotes.push('⚠️ Lối tiếp cận của nhân viên cứu hộ tới cổng khu nuôi đang bị vật cản chặn!');
    if (!visitorViewingConnected) missingNotes.push('⚠️ Điểm ngắm thú chưa nối đường đá tới Cổng Bán Vé.');
    if (!hasEducationSign) missingNotes.push('Nên đặt Biển Giáo Dục cạnh điểm ngắm để tăng Uy tín bảo tồn.');
    if (animalCount > 2) missingNotes.push('⚠️ Khu nuôi đang quá đông cá thể, làm giảm độ thoải mái!');
  }

  return {
    zoneId,
    built,
    treesCount,
    waterCount,
    shelterCount,
    enrichmentCount,
    feederCount,
    quietnessScore,
    spaceScore,
    overallComfort,
    keeperAccessible,
    visitorViewingConnected,
    hasEducationSign,
    animalCount,
    missingNotes,
  };
}

export interface ReleaseEligibilityCheck {
  eligible: boolean;
  healthOk: boolean;
  comfortOk: boolean;
  rehabOk: boolean;
  wildReadinessOk: boolean;
  notPermanentHold: boolean;
  reasons: string[];
}

export function evaluateReleaseEligibility(animal: RescuedAnimal): ReleaseEligibilityCheck {
  const notPermanentHold = !animal.permanentCareRequired;
  const healthOk = animal.health >= 85;
  const comfortOk = animal.comfort >= 75;
  const rehabOk = animal.rehabProgress >= 100;
  const wildReadinessOk = animal.wildReadiness >= 85;

  const reasons: string[] = [];
  if (!notPermanentHold) {
    reasons.push(
      animal.permanentCareReason ||
        'Cá thể này có di chứng vĩnh viễn, cần được chăm sóc nhân đạo lâu dài tại vườn bảo tồn.'
    );
  }
  if (!healthOk) reasons.push(`Sức khỏe cần đạt tối thiểu 85% (hiện tại: ${Math.round(animal.health)}%).`);
  if (!comfortOk) reasons.push(`Mức thoải mái môi trường cần đạt tối thiểu 75% (hiện tại: ${Math.round(animal.comfort)}%).`);
  if (!rehabOk) reasons.push(`Tiến độ phục hồi cần đạt 100% (hiện tại: ${Math.round(animal.rehabProgress)}%).`);
  if (!wildReadinessOk) {
    reasons.push(`Khả năng tự lập ngoài tự nhiên cần đạt tối thiểu 85% (hiện tại: ${Math.round(animal.wildReadiness)}%).`);
  }

  return {
    eligible: notPermanentHold && healthOk && comfortOk && rehabOk && wildReadinessOk,
    healthOk,
    comfortOk,
    rehabOk,
    wildReadinessOk,
    notPermanentHold,
    reasons,
  };
}
