import {
  ParkSaveProfile,
  PlacedItem,
  INITIAL_RESCUE_CASES,
  AllSpeciesId,
} from '../data/conservationData';

const STORAGE_INDEX_KEY = 'idle_zoo_3d_sanctuary_profiles_v1';
const STORAGE_ACTIVE_ID_KEY = 'idle_zoo_3d_sanctuary_active_profile_v1';
const STORAGE_PROFILE_PREFIX = 'idle_zoo_3d_sanctuary_save_v1_';
const CURRENT_SAVE_VERSION = 1;

export interface ProfileMeta {
  profileId: string;
  parkName: string;
  lastSavedAtMs: number;
  money: number;
  reputation: number;
  animalCount: number;
  releasedCount: number;
}

export function createStarterPlacedItems(): PlacedItem[] {
  const items: PlacedItem[] = [];
  let idCounter = 1;
  const add = (catalogId: string, gx: number, gz: number, rotationY = 0) => {
    items.push({
      uid: `starter_${idCounter++}`,
      catalogId,
      gx,
      gz,
      rotationY,
    });
  };

  // Main spine road from Gate (0, 11) North to Rescue Station (0, -7)
  for (let z = -6; z <= 11; z++) {
    add('path_stone', 0, z);
  }
  // Branch road West to Meadow Glade viewing point (-2, -2) & (-1, -2)
  add('path_stone', -1, -2);
  add('path_stone', -2, -2);
  // Branch road East to Pine Highland viewing point (1, -2) & (2, -2)
  add('path_stone', 1, -2);
  add('path_stone', 2, -2);
  // Branch road West-South to Woodland Stream viewing point (-1, 8) & (-2, 8)
  add('path_stone', -1, 8);
  add('path_stone', -2, 8);

  // Education signboard at Meadow Glade viewing area
  add('edu_signboard', -2, -1);
  // Rest bench & green kiosk near central plaza
  add('bench_rest', -1, 2, Math.PI / 2);
  add('service_kiosk', 2, 3, -Math.PI / 2);

  // Starter items inside Khu 1 (Meadow Glade: center -7, -2; x in [-10..-4], z in [-5..1])
  // Start with basic trees and feeder so player can add pond/shelter/trees to boost comfort from ~62% to 100%
  add('tree_common', -9, -4);
  add('tree_common', -8, 0);
  add('pond_natural', -9, -1); // 2x2 at (-9,-1)
  add('feeder_hay', -5, -2);

  return items;
}

export function createDefaultProfile(profileId: string, parkName: string): ParkSaveProfile {
  const now = Date.now();
  const initialKnowledge: AllSpeciesId[] = [
    'red_deer',
    'gray_wolf',
    'red_fox',
    'saola',
    'dhole',
    'sunda_pangolin',
  ];

  // Deep clone initial rescue cases; first deer is already admitted so player can immediately experience care or admit more
  const starterCases = JSON.parse(JSON.stringify(INITIAL_RESCUE_CASES));
  const firstCase = starterCases.shift()!;

  return {
    saveVersion: CURRENT_SAVE_VERSION,
    profileId,
    parkName: parkName.trim() || 'Vườn Cứu Hộ Sao Mai',
    createdAtIso: new Date(now).toISOString(),
    lastSavedAtMs: now,
    lastActiveAtMs: now,
    lastAfkClaimedAtMs: now,
    simSecondsElapsed: 0,
    money: 480,
    conservationReputation: 15,
    ticketPrice: 15,
    staffAutoCareEnabled: true,
    builtZones: {
      meadow_glade: true,
      pine_highland: false,
      woodland_stream: false,
    },
    placedItems: createStarterPlacedItems(),
    animals: [
      {
        id: 'animal_starter_deer_1',
        code: firstCase.code,
        name: firstCase.defaultName,
        speciesId: firstCase.speciesId,
        zoneId: firstCase.zoneId,
        stage: firstCase.initialStage,
        hunger: 74,
        health: 68,
        comfort: 78,
        rehabProgress: 38,
        wildReadiness: 42,
        permanentCareRequired: false,
        rescueOriginStory: firstCase.story,
        rescuedAtSimTime: 0,
        currentBehavior: 'Idle',
        lastFedTimestamp: now,
        lastVetCheckTimestamp: now,
      },
    ],
    pendingRescueCases: starterCases,
    releasedRecords: [],
    unlockedSpeciesKnowledge: initialKnowledge,
    completedMilestones: ['welcome_sanctuary'],
    stats: {
      totalVisitorsServed: 0,
      totalVisitorsEducated: 0,
      totalTicketRevenue: 0,
      totalServiceRevenue: 0,
      totalCareExpenses: 0,
      visitorSatisfaction: 84,
    },
  };
}

export class SaveManager {
  static listProfiles(): ProfileMeta[] {
    try {
      const raw = localStorage.getItem(STORAGE_INDEX_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }

  static saveProfileIndex(list: ProfileMeta[]): void {
    localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(list));
  }

  static getActiveProfileId(): string | null {
    return localStorage.getItem(STORAGE_ACTIVE_ID_KEY);
  }

  static setActiveProfileId(profileId: string): void {
    localStorage.setItem(STORAGE_ACTIVE_ID_KEY, profileId);
  }

  static validateProfileData(data: unknown): { valid: boolean; error?: string; profile?: ParkSaveProfile } {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Dữ liệu JSON không phải là một đối tượng hợp lệ.' };
    }
    const obj = data as Partial<ParkSaveProfile>;
    if (typeof obj.saveVersion !== 'number' || obj.saveVersion < 1) {
      return { valid: false, error: 'Thiếu hoặc sai phiên bản lưu (saveVersion).' };
    }
    if (typeof obj.profileId !== 'string' || !obj.profileId.trim()) {
      return { valid: false, error: 'Thiếu mã hồ sơ vườn (profileId).' };
    }
    if (typeof obj.parkName !== 'string' || !obj.parkName.trim()) {
      return { valid: false, error: 'Thiếu tên vườn (parkName).' };
    }
    if (typeof obj.money !== 'number' || Number.isNaN(obj.money)) {
      return { valid: false, error: 'Số dư kinh phí (money) không hợp lệ.' };
    }
    if (typeof obj.conservationReputation !== 'number' || Number.isNaN(obj.conservationReputation)) {
      return { valid: false, error: 'Điểm Uy tín bảo tồn không hợp lệ.' };
    }
    if (!obj.builtZones || typeof obj.builtZones !== 'object') {
      return { valid: false, error: 'Thiếu dữ liệu khu nuôi (builtZones).' };
    }
    if (!Array.isArray(obj.placedItems) || !Array.isArray(obj.animals) || !Array.isArray(obj.releasedRecords)) {
      return { valid: false, error: 'Cấu trúc danh sách công trình, cá thể thú hoặc sổ tái thả bị hỏng.' };
    }
    return { valid: true, profile: obj as ParkSaveProfile };
  }

  static loadProfile(profileId: string): { profile: ParkSaveProfile | null; corruptedRaw?: string; error?: string } {
    const key = STORAGE_PROFILE_PREFIX + profileId;
    const raw = localStorage.getItem(key);
    if (!raw) return { profile: null };
    try {
      const parsed = JSON.parse(raw);
      const check = this.validateProfileData(parsed);
      if (!check.valid || !check.profile) {
        // Backup corrupted raw string so data is NEVER silently deleted
        localStorage.setItem(`${key}_corrupted_backup_${Date.now()}`, raw);
        return { profile: null, corruptedRaw: raw, error: check.error };
      }
      return { profile: check.profile };
    } catch (err) {
      localStorage.setItem(`${key}_corrupted_backup_${Date.now()}`, raw);
      return {
        profile: null,
        corruptedRaw: raw,
        error: err instanceof Error ? err.message : 'Lỗi phân tích cú pháp JSON.',
      };
    }
  }

  static saveProfile(profile: ParkSaveProfile): void {
    profile.lastSavedAtMs = Date.now();
    const key = STORAGE_PROFILE_PREFIX + profile.profileId;
    localStorage.setItem(key, JSON.stringify(profile));

    const list = this.listProfiles();
    const meta: ProfileMeta = {
      profileId: profile.profileId,
      parkName: profile.parkName,
      lastSavedAtMs: profile.lastSavedAtMs,
      money: Math.round(profile.money),
      reputation: Math.round(profile.conservationReputation),
      animalCount: profile.animals.length,
      releasedCount: profile.releasedRecords.length,
    };
    const idx = list.findIndex((p) => p.profileId === profile.profileId);
    if (idx >= 0) {
      list[idx] = meta;
    } else {
      list.push(meta);
    }
    this.saveProfileIndex(list);
    this.setActiveProfileId(profile.profileId);
  }

  static createNewProfile(parkName: string): ParkSaveProfile {
    const profileId = 'zoo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const profile = createDefaultProfile(profileId, parkName);
    this.saveProfile(profile);
    return profile;
  }

  static ensureInitialProfile(): { profile: ParkSaveProfile; warning?: string } {
    const activeId = this.getActiveProfileId();
    if (activeId) {
      const res = this.loadProfile(activeId);
      if (res.profile) {
        return { profile: res.profile };
      }
      if (res.error) {
        const fallback = this.createNewProfile('Vườn Cứu Hộ Sao Mai (Khôi phục)');
        return {
          profile: fallback,
          warning: `Phát hiện dữ liệu hồ sơ cũ bị lỗi (${res.error}). Hệ thống đã giữ nguyên bản sao lưu dự phòng trong bộ nhớ trình duyệt và tạo hồ sơ an toàn mới.`,
        };
      }
    }
    const list = this.listProfiles();
    if (list.length > 0) {
      const first = this.loadProfile(list[0].profileId);
      if (first.profile) {
        this.setActiveProfileId(first.profile.profileId);
        return { profile: first.profile };
      }
    }
    const created = this.createNewProfile('Vườn Cứu Hộ Sao Mai');
    return { profile: created };
  }

  static exportProfileJson(profile: ParkSaveProfile): string {
    return JSON.stringify(profile, null, 2);
  }
}

export interface AfkReport {
  elapsedSeconds: number;
  cappedSeconds: number;
  wasCapped: boolean;
  visitorsEstimated: number;
  ticketIncome: number;
  serviceIncome: number;
  staffCareCost: number;
  netBalanceChange: number;
  animalsCaredCount: number;
}

export function calculateAndApplyAfkProgress(profile: ParkSaveProfile, nowMs: number = Date.now()): AfkReport | null {
  // Never invent fake AFK time; use real elapsed time since max(lastActiveAtMs, lastAfkClaimedAtMs)
  const baselineMs = Math.max(profile.lastActiveAtMs || nowMs, profile.lastAfkClaimedAtMs || nowMs);
  const rawElapsedSec = Math.floor((nowMs - baselineMs) / 1000);

  // Update timestamps immediately to prevent duplicate rewards on reload
  profile.lastActiveAtMs = nowMs;
  profile.lastAfkClaimedAtMs = nowMs;

  // Minimum 45 seconds away to count as AFK report
  if (rawElapsedSec < 45) {
    return null;
  }

  const MAX_AFK_SECONDS = 4 * 3600; // 4 hours cap
  const cappedSeconds = Math.min(rawElapsedSec, MAX_AFK_SECONDS);
  const wasCapped = rawElapsedSec > MAX_AFK_SECONDS;

  const activeZonesCount = Object.values(profile.builtZones).filter(Boolean).length;
  const animalCount = profile.animals.length;
  const hasKiosk = profile.placedItems.some((i) => i.catalogId === 'service_kiosk');

  // Reasonable visitor rate based on ticket price and welfare
  const priceFactor = Math.max(0.25, Math.min(1.3, (28 - profile.ticketPrice) / 15));
  const visitorsPerMinute = (1.2 + activeZonesCount * 0.8 + animalCount * 0.6) * priceFactor;
  const visitorsEstimated = Math.max(1, Math.floor((cappedSeconds / 60) * visitorsPerMinute));

  const ticketIncome = Math.round(visitorsEstimated * profile.ticketPrice * 0.65);
  const serviceIncome = hasKiosk ? Math.round(visitorsEstimated * 3.5) : 0;

  // Staff care expense & safe welfare preservation (Animals NEVER die or suffer permanent loss while player rests)
  const careRatePerMinute = animalCount * 2.2 + activeZonesCount * 1.0;
  const staffCareCost = Math.round((cappedSeconds / 60) * careRatePerMinute);
  const netBalanceChange = ticketIncome + serviceIncome - staffCareCost;

  profile.money = Math.max(20, profile.money + netBalanceChange);
  profile.stats.totalVisitorsServed += visitorsEstimated;
  profile.stats.totalTicketRevenue += ticketIncome;
  profile.stats.totalServiceRevenue += serviceIncome;
  profile.stats.totalCareExpenses += staffCareCost;

  for (const animal of profile.animals) {
    if (profile.staffAutoCareEnabled) {
      animal.hunger = Math.max(68, Math.min(95, animal.hunger + 10));
      animal.health = Math.max(70, Math.min(100, animal.health + 8));
      animal.comfort = Math.max(65, animal.comfort);
      const rehabGain = Math.min(18, Math.floor(cappedSeconds / 180));
      animal.rehabProgress = Math.min(100, animal.rehabProgress + rehabGain);
      animal.wildReadiness = Math.min(100, animal.wildReadiness + rehabGain);
    } else {
      // Even without auto-care, never let hunger or health drop below safe threshold 45
      animal.hunger = Math.max(45, animal.hunger - 12);
      animal.health = Math.max(55, animal.health);
    }
  }

  return {
    elapsedSeconds: rawElapsedSec,
    cappedSeconds,
    wasCapped,
    visitorsEstimated,
    ticketIncome,
    serviceIncome,
    staffCareCost,
    netBalanceChange,
    animalsCaredCount: animalCount,
  };
}
