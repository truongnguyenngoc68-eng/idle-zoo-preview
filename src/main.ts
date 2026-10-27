import './style.css';
import {
  HABITAT_ZONES,
  HabitatZoneId,
  PLACEABLE_CATALOG,
  ParkSaveProfile,
  SPECIES_DATABASE,
  AllSpeciesId,
  RescuedAnimal,
  ReleasedAnimalRecord,
} from './data/conservationData';
import {
  SaveManager,
  calculateAndApplyAfkProgress,
  AfkReport,
} from './systems/saveSystem';
import {
  evaluateZoneWelfare,
  evaluateReleaseEligibility,
  getCatalogItem,
  validatePlacement,
} from './systems/simulationCore';
import { ZooScene3D } from './systems/scene3d';

type ActivePanelId = 'rescue' | 'build' | 'visitors' | 'species' | 'release' | 'profiles' | null;

type BuildInteractionMode =
  | { type: 'none' }
  | { type: 'place'; catalogId: string; rotationY: number }
  | { type: 'move_select' }
  | { type: 'move_place'; itemUid: string; catalogId: string; rotationY: number }
  | { type: 'sell' };

class IdleZooApp {
  public profile!: ParkSaveProfile;
  public scene3d!: ZooScene3D;
  private activePanel: ActivePanelId = null;
  private buildMode: BuildInteractionMode = { type: 'none' };
  private lastHoverGrid = { gx: 0, gz: 0 };

  private simAccumulator = 0;
  private visitorSpawnTimer = 4.0;
  private autoSaveTimer = 10.0;
  private selectedAnimalIdForFocus: string | null = null;

  public async init(): Promise<void> {
    const initRes = SaveManager.ensureInitialProfile();
    this.profile = initRes.profile;

    const viewport = document.getElementById('viewport-3d')!;
    const labels = document.getElementById('world-labels')!;
    this.scene3d = new ZooScene3D(viewport, labels);

    await this.scene3d.preloadCoreAssets();
    this.scene3d.rebuildWorldFromProfile(this.profile);

    this.bindUiEvents();
    this.updateHud();

    if (initRes.warning) {
      this.showToast(initRes.warning);
    }

    // Check real AFK progress since last active session
    const afkReport = calculateAndApplyAfkProgress(this.profile, Date.now());
    SaveManager.saveProfile(this.profile);
    if (afkReport) {
      this.showAfkReportModal(afkReport);
    }

    // Start main game loop
    let lastTime = performance.now();
    const animate = (now: number) => {
      requestAnimationFrame(animate);
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      this.tick(dt);
    };
    requestAnimationFrame(animate);

    // Expose safe test helpers on window for Playwright verification
    (window as unknown as Record<string, unknown>).__IDLE_ZOO_APP__ = this;
  }

  private tick(dt: number): void {
    this.scene3d.stepFrame(dt, this.profile, (educated, sat) => {
      this.onVisitorFinishedTour(educated, sat);
    });

    this.simAccumulator += dt;
    if (this.simAccumulator >= 1.0) {
      const steps = Math.floor(this.simAccumulator);
      this.simAccumulator -= steps;
      this.stepSimulationOneSecond(steps);
    }

    this.visitorSpawnTimer -= dt;
    if (this.visitorSpawnTimer <= 0) {
      this.trySpawnVisitor();
      // Ticket price affects arrival interval (fair range 5..40đ)
      const priceDelay = Math.max(3.5, Math.min(14, (this.profile.ticketPrice - 5) * 0.35 + 4.5));
      this.visitorSpawnTimer = priceDelay;
    }

    this.autoSaveTimer -= dt;
    if (this.autoSaveTimer <= 0) {
      this.autoSaveTimer = 10.0;
      this.saveNow();
    }
  }

  private stepSimulationOneSecond(seconds: number): void {
    this.profile.simSecondsElapsed += seconds;
    this.profile.lastActiveAtMs = Date.now();

    // Update each rescued animal's welfare, hunger, health, growth stage, and rehab progress
    for (const animal of this.profile.animals) {
      const welfare = evaluateZoneWelfare(this.profile, animal.zoneId);
      animal.comfort = welfare.overallComfort;

      // Natural hunger decay
      animal.hunger = Math.max(20, animal.hunger - 0.35 * seconds);

      // Staff auto-care if keeper has clear path and player has money
      if (
        this.profile.staffAutoCareEnabled &&
        welfare.keeperAccessible &&
        welfare.feederCount > 0 &&
        animal.hunger < 68 &&
        this.profile.money >= 6
      ) {
        this.profile.money -= 6;
        this.profile.stats.totalCareExpenses += 6;
        animal.hunger = Math.min(100, animal.hunger + 28);
        animal.lastFedTimestamp = Date.now();
        this.showToast(`🧑‍⚕️ Nhân viên đã tiếp thức ăn cho ${animal.name} (-6đ)`);
      }

      // Health recovery if well-fed and comfortable
      if (animal.hunger >= 55 && animal.comfort >= 65) {
        animal.health = Math.min(100, animal.health + 0.55 * seconds);
      } else if (animal.hunger < 35) {
        // Never let animals die; floor at 40%
        animal.health = Math.max(40, animal.health - 0.25 * seconds);
      }

      // Rehabilitation & wild readiness progression (tuned so 10-15 min or active care completes a full cycle)
      if (animal.health >= 70 && animal.comfort >= 70 && animal.hunger >= 55) {
        const rate = (animal.comfort / 100) * 0.85 * seconds;
        animal.rehabProgress = Math.min(100, animal.rehabProgress + rate);
        const enrichBonus = Math.min(1.2, 0.5 + welfare.enrichmentCount * 0.35);
        animal.wildReadiness = Math.min(100, animal.wildReadiness + rate * enrichBonus);
      }

      // Growth stage transition (with model scale/Stag upgrade)
      const prevStage = animal.stage;
      if (animal.rehabProgress >= 80 && animal.health >= 80) {
        animal.stage = 'adult_ready';
      } else if (animal.rehabProgress >= 45) {
        animal.stage = 'rehab_subadult';
      }
      if (prevStage !== animal.stage) {
        this.scene3d.syncAnimals(this.profile);
      }
    }

    // Check post-release GPS collar follow-up messages
    const nowMs = Date.now();
    for (const rec of this.profile.releasedRecords) {
      if (rec.followUpStage < 2 && rec.nextFollowUpAtMs && nowMs >= rec.nextFollowUpAtMs) {
        this.deliverWildFollowUpUpdate(rec);
      }
    }

    this.updateHud();
  }

  private deliverWildFollowUpUpdate(rec: ReleasedAnimalRecord): void {
    const species = SPECIES_DATABASE[rec.speciesId];
    rec.followUpStage += 1;
    if (rec.followUpStage === 1) {
      rec.followUpUpdates.unshift({
        id: 'upd_' + Date.now(),
        timestampIso: new Date().toISOString(),
        title: `📡 Tín hiệu Vòng cổ Theo dõi #1 — ${rec.name} (${rec.code})`,
        message: `${species.vietnameseName} ${rec.name} đã di chuyển 4.2 km vào vùng lõi "${rec.releaseHabitatName}", tìm được nguồn nước tự nhiên và bắt đầu kiếm ăn độc lập.`,
        collarSignalStrength: 'Tốt (GPS 96%)',
      });
      rec.nextFollowUpAtMs = Date.now() + 25000;
    } else {
      rec.followUpUpdates.unshift({
        id: 'upd_' + Date.now(),
        timestampIso: new Date().toISOString(),
        title: `🌿 Báo cáo Hòa nhập Thành công #2 — ${rec.name} (${rec.code})`,
        message: `Camera bẫy ảnh ghi nhận ${rec.name} khỏe mạnh, phản xạ cảnh giác tốt và đã hòa nhập hoàn toàn với quần thể ${species.vietnameseName} hoang dã tại ${rec.releaseHabitatName}.`,
        collarSignalStrength: 'Ổn định (GPS 99%)',
      });
      rec.nextFollowUpAtMs = undefined;
    }

    this.showToast(`📡 Nhận tin theo dõi ngoài tự nhiên từ ${rec.name} (${rec.code})!`);
    if (this.activePanel === 'release') {
      this.renderActiveDrawer();
    }
    this.saveNow();
  }

  private trySpawnVisitor(): void {
    // If ticket price is unreasonable (> 35đ), visitors refuse to enter
    if (this.profile.ticketPrice > 35) {
      return;
    }
    const builtZones = (Object.keys(HABITAT_ZONES) as HabitatZoneId[]).filter(
      (z) => this.profile.builtZones[z] && evaluateZoneWelfare(this.profile, z).visitorViewingConnected
    );
    if (builtZones.length === 0) return;

    const targetZone = builtZones[Math.floor(Math.random() * builtZones.length)];
    const spawned = this.scene3d.spawnVisitor(this.profile, targetZone);
    if (spawned) {
      // One-time ticket purchase at entrance gate
      const ticketRev = this.profile.ticketPrice;
      const hasKiosk = this.profile.placedItems.some((i) => i.catalogId === 'service_kiosk');
      const serviceRev = hasKiosk ? 4 : 0;

      this.profile.money += ticketRev + serviceRev;
      this.profile.stats.totalVisitorsServed += 1;
      this.profile.stats.totalTicketRevenue += ticketRev;
      this.profile.stats.totalServiceRevenue += serviceRev;
      this.updateHud();
    }
  }

  private onVisitorFinishedTour(educated: boolean, satisfaction: number): void {
    if (educated) {
      this.profile.stats.totalVisitorsEducated += 1;
      this.profile.conservationReputation += 2;
    }
    this.profile.stats.visitorSatisfaction = Math.round(
      this.profile.stats.visitorSatisfaction * 0.8 + satisfaction * 0.2
    );
    this.updateHud();
  }

  public saveNow(): void {
    SaveManager.saveProfile(this.profile);
    const statusEl = document.getElementById('hud-save-status');
    if (statusEl) {
      const timeStr = new Date(this.profile.lastSavedAtMs).toLocaleTimeString('vi-VN');
      statusEl.textContent = `💾 Đã tự lưu lúc ${timeStr} (Lưu cục bộ trên trình duyệt)`;
    }
  }

  public updateHud(): void {
    document.getElementById('hud-park-name')!.textContent = this.profile.parkName;
    document.getElementById('hud-money')!.textContent = `${Math.round(this.profile.money)} đ`;
    document.getElementById('hud-reputation')!.textContent = `${Math.round(
      this.profile.conservationReputation
    )} điểm`;
    document.getElementById('hud-ticket-summary')!.textContent = `${this.profile.ticketPrice}đ • ${Math.round(
      this.profile.stats.visitorSatisfaction
    )}%`;
    document.getElementById('hud-animals-summary')!.textContent = `${this.profile.animals.length} nuôi • ${this.profile.releasedRecords.length} thả`;

    document.getElementById('badge-rescue-count')!.textContent = String(
      this.profile.animals.length + this.profile.pendingRescueCases.length
    );
    document.getElementById('badge-release-count')!.textContent = String(
      this.profile.releasedRecords.length
    );
  }

  private bindUiEvents(): void {
    // Camera controls
    document.getElementById('btn-cam-reset')!.addEventListener('click', () => {
      this.scene3d.resetCamera();
    });
    document.getElementById('btn-cam-zoom-in')!.addEventListener('click', () => {
      this.scene3d.zoomBy(-5);
    });
    document.getElementById('btn-cam-zoom-out')!.addEventListener('click', () => {
      this.scene3d.zoomBy(5);
    });

    // Debug panel toggle (default closed)
    const debugPanel = document.getElementById('debug-panel')!;
    document.getElementById('btn-toggle-debug')!.addEventListener('click', () => {
      debugPanel.classList.toggle('hidden');
    });
    document.getElementById('btn-close-debug')!.addEventListener('click', () => {
      debugPanel.classList.add('hidden');
    });

    // Debug actions
    document.getElementById('dbg-spawn-visitor')!.addEventListener('click', () => {
      this.trySpawnVisitor();
      this.showToast('🚶 Đã gọi khách tham quan tới cổng bán vé.');
    });
    document.getElementById('dbg-fast-rehab')!.addEventListener('click', () => {
      for (const a of this.profile.animals) {
        a.health = Math.min(100, a.health + 25);
        a.hunger = Math.min(100, a.hunger + 30);
        a.rehabProgress = Math.min(100, a.rehabProgress + 35);
        a.wildReadiness = Math.min(100, a.wildReadiness + 35);
        if (a.rehabProgress >= 80) a.stage = 'adult_ready';
      }
      this.scene3d.syncAnimals(this.profile);
      this.updateHud();
      this.renderActiveDrawer();
      this.saveNow();
      this.showToast('⚡ Đã cập nhật tiến độ phục hồi để kiểm thử nhanh.');
    });
    document.getElementById('dbg-trigger-telemetry')!.addEventListener('click', () => {
      const rec = this.profile.releasedRecords[0];
      if (!rec) {
        this.showToast('Chưa có cá thể nào trong Sổ Tái Thả.');
        return;
      }
      this.deliverWildFollowUpUpdate(rec);
    });
    document.getElementById('dbg-sim-afk-2h')!.addEventListener('click', () => {
      const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
      this.profile.lastActiveAtMs = twoHoursAgo;
      this.profile.lastAfkClaimedAtMs = twoHoursAgo;
      const rep = calculateAndApplyAfkProgress(this.profile, Date.now());
      this.saveNow();
      this.updateHud();
      if (rep) this.showAfkReportModal(rep);
    });

    // Bottom Dock navigation
    const dockBtns = document.querySelectorAll('.dock-btn');
    dockBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = btn.getAttribute('data-panel') as ActivePanelId;
        if (this.activePanel === panel) {
          this.closeDrawer();
        } else {
          this.openDrawer(panel);
        }
      });
    });

    document.getElementById('btn-close-drawer')!.addEventListener('click', () => {
      this.closeDrawer();
    });

    // Build mode controls
    document.getElementById('btn-cancel-build')!.addEventListener('click', () => {
      this.setBuildMode({ type: 'none' });
    });
    document.getElementById('btn-rotate-item')!.addEventListener('click', () => {
      this.rotateCurrentPlacement();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.setBuildMode({ type: 'none' });
      } else if (e.key === 'r' || e.key === 'R') {
        if (this.buildMode.type === 'place' || this.buildMode.type === 'move_place') {
          this.rotateCurrentPlacement();
        }
      }
    });

    // Modal close
    document.getElementById('btn-close-modal')!.addEventListener('click', () => {
      document.getElementById('modal-overlay')!.classList.add('hidden');
    });

    // 3D Scene interactions
    this.scene3d.setInteractionCallbacks({
      onTileClick: (gx, gz) => this.handleGridTileClick(gx, gz),
      onAnimalClick: (animalId) => {
        this.selectedAnimalIdForFocus = animalId;
        this.openDrawer('rescue');
      },
      onZoneViewingClick: (zoneId) => {
        this.showViewingEducationModal(zoneId);
      },
      onHoverChange: (gx, gz) => {
        this.lastHoverGrid = { gx, gz };
        this.refreshPlacementGhost();
      },
    });
  }

  private rotateCurrentPlacement(): void {
    if (this.buildMode.type === 'place' || this.buildMode.type === 'move_place') {
      this.buildMode.rotationY = (this.buildMode.rotationY + Math.PI / 2) % (Math.PI * 2);
      this.refreshPlacementGhost();
    }
  }

  public setBuildMode(mode: BuildInteractionMode): void {
    this.buildMode = mode;
    const banner = document.getElementById('build-mode-banner')!;
    const textEl = document.getElementById('build-mode-text')!;

    if (mode.type === 'none') {
      banner.classList.add('hidden');
      this.scene3d.updatePlacementPreview(null, 0, 0, true);
      return;
    }

    banner.classList.remove('hidden');
    if (mode.type === 'place') {
      const cat = getCatalogItem(mode.catalogId)!;
      textEl.textContent = `Đang đặt: ${cat.name} (Giá: ${cat.cost}đ) — Nhấp lên ô lưới xanh để đặt`;
    } else if (mode.type === 'move_select') {
      textEl.textContent = `Di chuyển công trình: Nhấp vào một công trình trên bản đồ để nhấc lên`;
      this.scene3d.updatePlacementPreview(null, 0, 0, true);
    } else if (mode.type === 'move_place') {
      const cat = getCatalogItem(mode.catalogId)!;
      textEl.textContent = `Đang dời vị trí: ${cat.name} (Miễn phí) — Nhấp ô lưới mới`;
    } else if (mode.type === 'sell') {
      textEl.textContent = `Bán lại công trình: Nhấp vào công trình trên bản đồ để tháo dỡ & nhận tiền hoàn lại`;
      this.scene3d.updatePlacementPreview(null, 0, 0, true);
    }

    this.refreshPlacementGhost();
  }

  private refreshPlacementGhost(): void {
    const { gx, gz } = this.lastHoverGrid;
    if (this.buildMode.type === 'place') {
      const cat = getCatalogItem(this.buildMode.catalogId);
      if (!cat) return;
      const check = validatePlacement(this.profile, cat, gx, gz);
      this.scene3d.updatePlacementPreview(
        cat.id,
        gx,
        gz,
        check.valid && this.profile.money >= cat.cost,
        this.buildMode.rotationY
      );
    } else if (this.buildMode.type === 'move_place') {
      const cat = getCatalogItem(this.buildMode.catalogId);
      if (!cat) return;
      const check = validatePlacement(this.profile, cat, gx, gz, this.buildMode.itemUid);
      this.scene3d.updatePlacementPreview(cat.id, gx, gz, check.valid, this.buildMode.rotationY);
    }
  }

  private handleGridTileClick(gx: number, gz: number): void {
    if (this.buildMode.type === 'place') {
      const cat = getCatalogItem(this.buildMode.catalogId);
      if (!cat) return;
      if (this.profile.money < cat.cost) {
        this.showToast(`⚠️ Không đủ kinh phí! Cần ${cat.cost}đ (Hiện có ${Math.round(this.profile.money)}đ).`);
        return;
      }
      const check = validatePlacement(this.profile, cat, gx, gz);
      if (!check.valid) {
        this.showToast(`⚠️ Không thể đặt: ${check.reason}`);
        return;
      }

      this.profile.money -= cat.cost;
      this.profile.placedItems.push({
        uid: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        catalogId: cat.id,
        gx,
        gz,
        rotationY: this.buildMode.rotationY,
      });

      this.scene3d.rebuildPlacedItems(this.profile);
      this.recalculateAllAnimalsComfort();
      this.updateHud();
      this.saveNow();
      this.refreshPlacementGhost();
      if (this.activePanel) this.renderActiveDrawer();
      this.showToast(`✅ Đã đặt ${cat.name} (-${cat.cost}đ).`);
    } else if (this.buildMode.type === 'move_select') {
      const found = this.findPlacedItemAtCell(gx, gz);
      if (!found) {
        this.showToast('Không có công trình nào tại ô này để di chuyển.');
        return;
      }
      this.setBuildMode({
        type: 'move_place',
        itemUid: found.uid,
        catalogId: found.catalogId,
        rotationY: found.rotationY,
      });
    } else if (this.buildMode.type === 'move_place') {
      const cat = getCatalogItem(this.buildMode.catalogId);
      const targetItem = this.profile.placedItems.find((i) => i.uid === this.buildMode.itemUid);
      if (!cat || !targetItem) {
        this.setBuildMode({ type: 'none' });
        return;
      }
      const check = validatePlacement(this.profile, cat, gx, gz, targetItem.uid);
      if (!check.valid) {
        this.showToast(`⚠️ Không thể dời tới ô này: ${check.reason}`);
        return;
      }
      targetItem.gx = gx;
      targetItem.gz = gz;
      targetItem.rotationY = this.buildMode.rotationY;
      this.scene3d.rebuildPlacedItems(this.profile);
      this.recalculateAllAnimalsComfort();
      this.saveNow();
      this.setBuildMode({ type: 'none' });
      if (this.activePanel) this.renderActiveDrawer();
      this.showToast(`✅ Đã di chuyển ${cat.name} sang vị trí (${gx}, ${gz}).`);
    } else if (this.buildMode.type === 'sell') {
      const foundIdx = this.profile.placedItems.findIndex((it) => {
        const cat = getCatalogItem(it.catalogId);
        if (!cat) return false;
        return (
          gx >= it.gx &&
          gx < it.gx + cat.footprintW &&
          gz >= it.gz &&
          gz < it.gz + cat.footprintD
        );
      });
      if (foundIdx < 0) {
        this.showToast('Không có công trình nào tại ô này để bán.');
        return;
      }
      const removed = this.profile.placedItems[foundIdx];
      const cat = getCatalogItem(removed.catalogId)!;
      this.profile.placedItems.splice(foundIdx, 1);
      this.profile.money += cat.refund;
      this.scene3d.rebuildPlacedItems(this.profile);
      this.recalculateAllAnimalsComfort();
      this.updateHud();
      this.saveNow();
      if (this.activePanel) this.renderActiveDrawer();
      this.showToast(`♻️ Đã tháo dỡ ${cat.name}, hoàn tiền +${cat.refund}đ.`);
    }
  }

  private findPlacedItemAtCell(gx: number, gz: number) {
    return this.profile.placedItems.find((it) => {
      const cat = getCatalogItem(it.catalogId);
      if (!cat) return false;
      return (
        gx >= it.gx &&
        gx < it.gx + cat.footprintW &&
        gz >= it.gz &&
        gz < it.gz + cat.footprintD
      );
    });
  }

  private recalculateAllAnimalsComfort(): void {
    for (const animal of this.profile.animals) {
      const w = evaluateZoneWelfare(this.profile, animal.zoneId);
      animal.comfort = w.overallComfort;
    }
  }

  public openDrawer(panel: ActivePanelId): void {
    this.activePanel = panel;
    const drawer = document.getElementById('side-drawer')!;
    document.querySelectorAll('.dock-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-panel') === panel);
    });
    if (!panel) {
      drawer.classList.add('hidden');
      return;
    }
    drawer.classList.remove('hidden');
    this.renderActiveDrawer();
  }

  public closeDrawer(): void {
    this.openDrawer(null);
  }

  private renderActiveDrawer(): void {
    const titleEl = document.getElementById('drawer-title')!;
    const bodyEl = document.getElementById('drawer-body')!;
    bodyEl.innerHTML = '';

    if (this.activePanel === 'rescue') {
      titleEl.textContent = '🚑 Chăm Sóc Cá Thể & Tiếp Nhận Cứu Hộ';
      this.renderRescuePanel(bodyEl);
    } else if (this.activePanel === 'build') {
      titleEl.textContent = '🏗️ Xây Khu Sống & Bố Trí Cảnh Quan';
      this.renderBuildPanel(bodyEl);
    } else if (this.activePanel === 'visitors') {
      titleEl.textContent = '🎟️ Khách Tham Quan, Giá Vé & Vận Hành';
      this.renderVisitorsPanel(bodyEl);
    } else if (this.activePanel === 'species') {
      titleEl.textContent = '📖 Sổ Loài & Dữ Liệu Khoa Học IUCN';
      this.renderSpeciesPanel(bodyEl);
    } else if (this.activePanel === 'release') {
      titleEl.textContent = '🕊️ Phục Hồi, Tái Thả & Sổ Theo Dõi Tự Nhiên';
      this.renderReleasePanel(bodyEl);
    } else if (this.activePanel === 'profiles') {
      titleEl.textContent = '💾 Quản Lý Hồ Sơ Vườn & Sao Lưu JSON';
      this.renderProfilesPanel(bodyEl);
    }
  }

  private renderRescuePanel(container: HTMLElement): void {
    // Limitation disclosure per section 5 & 2
    const noteBox = document.createElement('div');
    noteBox.className = 'sim-box';
    noteBox.innerHTML = `
      <strong>📌 Ghi chú mô phỏng bản thử:</strong> Giai đoạn lớn lên của cá thể dùng thay đổi tỉ lệ model 3D (Scale: 0.72x → 0.86x → 1.0x; Hươu Đỏ trưởng thành chuyển từ <code>Deer.glb</code> sang <code>Stag.glb</code>). Hành vi nghỉ ngơi dùng hoạt ảnh hạ đầu thư giãn (<code>Idle_Headlow</code>) cạnh chỗ trú do bộ Quaternius CC0 không có clip nằm ngủ riêng.
    `;
    container.appendChild(noteBox);

    // 1. Active Animals in Sanctuary
    for (const animal of this.profile.animals) {
      const species = SPECIES_DATABASE[animal.speciesId];
      const zone = HABITAT_ZONES[animal.zoneId];
      const welfare = evaluateZoneWelfare(this.profile, animal.zoneId);
      const releaseCheck = evaluateReleaseEligibility(animal);

      const stageName: Record<string, string> = {
        juvenile_rescue: 'Giai đoạn 1: Sơ cứu / Cá thể non (0.72x)',
        rehab_subadult: 'Giai đoạn 2: Đang phục hồi tập tính (0.86x)',
        adult_ready: 'Giai đoạn 3: Trưởng thành ổn định (1.0x)',
      };

      const card = document.createElement('div');
      card.className = 'panel-card';
      if (this.selectedAnimalIdForFocus === animal.id) {
        card.style.borderColor = '#34d399';
      }

      card.innerHTML = `
        <h3>
          <span>🐾 ${animal.name} <small>(${animal.code})</small></span>
          <span class="tag-badge tag-lc">${species.vietnameseName}</span>
        </h3>
        <p><strong>Sinh cảnh:</strong> ${zone.name} • <strong>Giai đoạn:</strong> ${stageName[animal.stage]}</p>
        <p><em>Hồ sơ cứu hộ:</em> ${animal.rescueOriginStory}</p>
        ${
          animal.permanentCareRequired
            ? `<div class="warn-box"><strong>🏥 Chăm sóc nhân đạo lâu dài:</strong> ${animal.permanentCareReason}</div>`
            : ''
        }

        <div class="stat-bars">
          <div class="stat-bar-item">
            <div>🍎 Độ no bụng: <strong>${Math.round(animal.hunger)}%</strong></div>
            <div class="progress-track"><div class="progress-fill" style="width:${animal.hunger}%"></div></div>
          </div>
          <div class="stat-bar-item">
            <div>❤️ Sức khỏe: <strong>${Math.round(animal.health)}%</strong></div>
            <div class="progress-track"><div class="progress-fill" style="width:${animal.health}%"></div></div>
          </div>
          <div class="stat-bar-item">
            <div>🌿 Mức thoải mái: <strong>${Math.round(animal.comfort)}%</strong></div>
            <div class="progress-track"><div class="progress-fill" style="width:${animal.comfort}%"></div></div>
          </div>
          <div class="stat-bar-item">
            <div>🎯 Phục hồi & Tự lập: <strong>${Math.round(animal.rehabProgress)}% / ${Math.round(animal.wildReadiness)}%</strong></div>
            <div class="progress-track"><div class="progress-fill" style="width:${animal.rehabProgress}%"></div></div>
          </div>
        </div>

        <div class="sim-box">
          <strong>Đánh giá Khu Sống (${zone.name}):</strong><br/>
          🌳 Cây xanh: ${welfare.treesCount}/${species.simulationTargets?.minTrees} |
          💧 Nước: ${welfare.waterCount}/${species.simulationTargets?.minWater} |
          🏠 Chỗ trú: ${welfare.shelterCount}/${species.simulationTargets?.minShelter} |
          🪵 Làm giàu: ${welfare.enrichmentCount}/${species.simulationTargets?.minEnrichment} |
          🤫 Yên tĩnh: ${welfare.quietnessScore}%
          ${
            welfare.missingNotes.length > 0
              ? `<br/><span style="color:#fcd34d">⚠️ Cần cải thiện: ${welfare.missingNotes.join(' • ')}</span>`
              : `<br/><span style="color:#6ee7b7">✅ Môi trường sống đạt chuẩn bảo tồn!</span>`
          }
        </div>
      `;

      // Rename input + action buttons
      const renameRow = document.createElement('div');
      renameRow.className = 'action-row';
      const nameInput = document.createElement('input');
      nameInput.className = 'input-text';
      nameInput.style.flex = '1';
      nameInput.value = animal.name;
      nameInput.placeholder = 'Đặt tên cá thể...';
      const btnRename = document.createElement('button');
      btnRename.className = 'btn-secondary btn-sm';
      btnRename.textContent = '✏️ Đổi tên';
      btnRename.addEventListener('click', () => {
        const clean = nameInput.value.trim();
        if (clean) {
          animal.name = clean;
          this.saveNow();
          this.renderActiveDrawer();
          this.showToast(`Đã đổi tên cá thể ${animal.code} thành "${clean}".`);
        }
      });
      renameRow.appendChild(nameInput);
      renameRow.appendChild(btnRename);
      card.appendChild(renameRow);

      const actionRow = document.createElement('div');
      actionRow.className = 'action-row';

      const btnFeed = document.createElement('button');
      btnFeed.className = 'btn-primary btn-sm';
      btnFeed.textContent = '🍎 Cho ăn & Nước sạch (-12đ)';
      btnFeed.addEventListener('click', () => {
        if (this.profile.money < 12) {
          this.showToast('⚠️ Không đủ kinh phí (Cần 12đ).');
          return;
        }
        this.profile.money -= 12;
        this.profile.stats.totalCareExpenses += 12;
        animal.hunger = Math.min(100, animal.hunger + 32);
        animal.health = Math.min(100, animal.health + 8);
        animal.rehabProgress = Math.min(100, animal.rehabProgress + 10);
        animal.wildReadiness = Math.min(100, animal.wildReadiness + 8);
        animal.currentBehavior = 'Eating';
        this.updateHud();
        this.saveNow();
        this.renderActiveDrawer();
        this.showToast(`🍎 Đã cho ${animal.name} ăn khẩu phần tự nhiên!`);
      });

      const btnVet = document.createElement('button');
      btnVet.className = 'btn-secondary btn-sm';
      btnVet.textContent = '🩺 Khám thú y & Tập phản xạ (-20đ)';
      btnVet.addEventListener('click', () => {
        if (this.profile.money < 20) {
          this.showToast('⚠️ Không đủ kinh phí khám thú y (Cần 20đ).');
          return;
        }
        this.profile.money -= 20;
        this.profile.stats.totalCareExpenses += 20;
        animal.health = Math.min(100, animal.health + 22);
        animal.rehabProgress = Math.min(100, animal.rehabProgress + 20);
        animal.wildReadiness = Math.min(100, animal.wildReadiness + 22);
        if (animal.rehabProgress >= 80 && animal.health >= 80) {
          animal.stage = 'adult_ready';
        } else if (animal.rehabProgress >= 45) {
          animal.stage = 'rehab_subadult';
        }
        this.scene3d.syncAnimals(this.profile);
        this.updateHud();
        this.saveNow();
        this.renderActiveDrawer();
        this.showToast(`🩺 Đã chăm sóc thú y & huấn luyện bản năng cho ${animal.name}!`);
      });

      const btnFocus = document.createElement('button');
      btnFocus.className = 'btn-secondary btn-sm';
      btnFocus.textContent = '🎥 Xem khu nuôi';
      btnFocus.addEventListener('click', () => {
        this.scene3d.focusOnZone(animal.zoneId);
      });

      actionRow.appendChild(btnFeed);
      actionRow.appendChild(btnVet);
      actionRow.appendChild(btnFocus);

      if (releaseCheck.eligible) {
        const btnGoRelease = document.createElement('button');
        btnGoRelease.className = 'btn-primary btn-sm';
        btnGoRelease.textContent = '🕊️ Đủ điều kiện Tái thả →';
        btnGoRelease.addEventListener('click', () => {
          this.openDrawer('release');
        });
        actionRow.appendChild(btnGoRelease);
      }

      card.appendChild(actionRow);
      container.appendChild(card);
    }

    // 2. Pending Rescue Cases waiting for intake
    const intakeHeader = document.createElement('h3');
    intakeHeader.style.marginTop = '8px';
    intakeHeader.style.fontSize = '14px';
    intakeHeader.style.color = '#fcd34d';
    intakeHeader.textContent = `📋 Danh Sách Ca Cứu Hộ Chờ Tiếp Nhận (${this.profile.pendingRescueCases.length})`;
    container.appendChild(intakeHeader);

    for (const c of this.profile.pendingRescueCases) {
      const species = SPECIES_DATABASE[c.speciesId];
      const zone = HABITAT_ZONES[c.zoneId];
      const zoneBuilt = !!this.profile.builtZones[c.zoneId];

      const card = document.createElement('div');
      card.className = 'panel-card';
      card.innerHTML = `
        <h3>
          <span>🆘 Ca cứu hộ: ${c.defaultName} (${c.code})</span>
          <span class="tag-badge tag-lc">${species.vietnameseName}</span>
        </h3>
        <p>${c.story}</p>
        <p><strong>Yêu cầu khu sống:</strong> ${zone.name} (${zoneBuilt ? '✅ Đã xây' : '❌ Chưa xây'})</p>
        <p><strong>Kinh phí hỗ trợ tiếp nhận ban đầu:</strong> +${c.intakeGrantMoney}đ</p>
      `;

      const btnAccept = document.createElement('button');
      btnAccept.className = 'btn-primary btn-sm';
      btnAccept.disabled = !zoneBuilt;
      btnAccept.textContent = zoneBuilt
        ? `🚑 Tiếp nhận ${c.defaultName} vào ${zone.name}`
        : `🔒 Cần xây "${zone.name}" tại mục Xây & Cảnh Quan trước`;

      btnAccept.addEventListener('click', () => {
        this.admitRescueCase(c.caseId);
      });

      card.appendChild(btnAccept);
      container.appendChild(card);
    }
  }

  public admitRescueCase(caseId: string): void {
    const idx = this.profile.pendingRescueCases.findIndex((c) => c.caseId === caseId);
    if (idx < 0) return;
    const c = this.profile.pendingRescueCases[idx];
    if (!this.profile.builtZones[c.zoneId]) {
      this.showToast('⚠️ Vui lòng xây Khu Cứu Hộ tương ứng trước khi tiếp nhận cá thể.');
      return;
    }

    this.profile.pendingRescueCases.splice(idx, 1);
    this.profile.money += c.intakeGrantMoney;

    const newAnimal: RescuedAnimal = {
      id: 'animal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      code: c.code,
      name: c.defaultName,
      speciesId: c.speciesId,
      zoneId: c.zoneId,
      stage: c.initialStage,
      hunger: c.initialHunger,
      health: c.initialHealth,
      comfort: evaluateZoneWelfare(this.profile, c.zoneId).overallComfort,
      rehabProgress: 20,
      wildReadiness: 25,
      permanentCareRequired: c.permanentCareRequired,
      permanentCareReason: c.permanentCareReason,
      rescueOriginStory: c.story,
      rescuedAtSimTime: this.profile.simSecondsElapsed,
      currentBehavior: 'Idle',
      lastFedTimestamp: Date.now(),
      lastVetCheckTimestamp: Date.now(),
    };

    this.profile.animals.push(newAnimal);
    this.scene3d.syncAnimals(this.profile);
    this.scene3d.focusOnZone(c.zoneId);
    this.updateHud();
    this.saveNow();
    this.renderActiveDrawer();
    this.showToast(`🚑 Đã tiếp nhận cá thể ${newAnimal.name} (${newAnimal.code})! Nhận hỗ trợ +${c.intakeGrantMoney}đ.`);
  }

  private renderBuildPanel(container: HTMLElement): void {
    // Move & Sell tool row
    const toolCard = document.createElement('div');
    toolCard.className = 'panel-card';
    toolCard.innerHTML = `
      <h3>🛠️ Công Cụ Chỉnh Sửa Lưới Vườn</h3>
      <p>Đặt, di chuyển hoặc tháo dỡ công trình trên lưới 3D. Có bóng xem trước xanh/đỏ, kiểm tra không đặt chồng, không chặn cổng và hoàn tiền rõ ràng.</p>
    `;
    const toolRow = document.createElement('div');
    toolRow.className = 'action-row';

    const btnMove = document.createElement('button');
    btnMove.className = 'btn-secondary btn-sm';
    btnMove.textContent = '✥ Di chuyển công trình (Miễn phí)';
    btnMove.addEventListener('click', () => {
      this.setBuildMode({ type: 'move_select' });
    });

    const btnSell = document.createElement('button');
    btnSell.className = 'btn-danger btn-sm';
    btnSell.textContent = '♻️ Bán / Tháo dỡ công trình (Hoàn tiền)';
    btnSell.addEventListener('click', () => {
      this.setBuildMode({ type: 'sell' });
    });

    toolRow.appendChild(btnMove);
    toolRow.appendChild(btnSell);
    toolCard.appendChild(toolRow);
    container.appendChild(toolCard);

    // 1. Three Habitat Zone Templates
    const zoneHeader = document.createElement('h3');
    zoneHeader.style.fontSize = '14px';
    zoneHeader.style.color = '#6ee7b7';
    zoneHeader.textContent = '🏞️ 3 Khu Nuôi Cứu Hộ Theo Sinh Cảnh Mẫu';
    container.appendChild(zoneHeader);

    for (const zId of Object.keys(HABITAT_ZONES) as HabitatZoneId[]) {
      const z = HABITAT_ZONES[zId];
      const built = !!this.profile.builtZones[zId];
      const species = SPECIES_DATABASE[z.speciesId];

      const card = document.createElement('div');
      card.className = 'panel-card';
      card.innerHTML = `
        <h3>
          <span>${z.name}</span>
          <span class="tag-badge tag-lc">${built ? 'Đã xây' : `${z.unlockCost}đ`}</span>
        </h3>
        <p><strong>Môi trường:</strong> ${z.environmentLabel} • <strong>Loài phù hợp:</strong> ${species.vietnameseName}</p>
        <p>${z.description}</p>
      `;

      const row = document.createElement('div');
      row.className = 'action-row';
      if (!built) {
        const btnBuildZone = document.createElement('button');
        btnBuildZone.className = 'btn-primary btn-sm';
        btnBuildZone.textContent = `🏗️ Xây dựng Khu Sống (${z.unlockCost}đ)`;
        btnBuildZone.addEventListener('click', () => {
          if (this.profile.money < z.unlockCost) {
            this.showToast(`⚠️ Không đủ kinh phí! Cần ${z.unlockCost}đ.`);
            return;
          }
          this.profile.money -= z.unlockCost;
          this.profile.builtZones[zId] = true;
          this.scene3d.rebuildEnclosures(this.profile);
          this.scene3d.focusOnZone(zId);
          this.updateHud();
          this.saveNow();
          this.renderActiveDrawer();
          this.showToast(`🎉 Đã xây xong ${z.name}!`);
        });
        row.appendChild(btnBuildZone);
      } else {
        const btnFocus = document.createElement('button');
        btnFocus.className = 'btn-secondary btn-sm';
        btnFocus.textContent = '🎥 Đưa camera tới khu này';
        btnFocus.addEventListener('click', () => this.scene3d.focusOnZone(zId));
        row.appendChild(btnFocus);
      }
      card.appendChild(row);
      container.appendChild(card);
    }

    // 2. Placeable Items Catalog
    const itemHeader = document.createElement('h3');
    itemHeader.style.fontSize = '14px';
    itemHeader.style.color = '#6ee7b7';
    itemHeader.style.marginTop = '6px';
    itemHeader.textContent = '🌳 Cây Xanh, Hồ Nước, Chỗ Trú, Đường Đi & Biển Giáo Dục';
    container.appendChild(itemHeader);

    for (const item of PLACEABLE_CATALOG) {
      const card = document.createElement('div');
      card.className = 'panel-card';
      card.innerHTML = `
        <h3>
          <span>${item.name} (${item.footprintW}x${item.footprintD})</span>
          <span class="tag-badge tag-lc">Giá: ${item.cost}đ • Hoàn: ${item.refund}đ</span>
        </h3>
        <p>${item.description}</p>
      `;
      const btnPlace = document.createElement('button');
      btnPlace.className = 'btn-primary btn-sm';
      btnPlace.textContent = `➕ Chọn đặt ${item.name} (${item.cost}đ)`;
      btnPlace.addEventListener('click', () => {
        this.setBuildMode({ type: 'place', catalogId: item.id, rotationY: 0 });
      });
      card.appendChild(btnPlace);
      container.appendChild(card);
    }
  }

  private renderVisitorsPanel(container: HTMLElement): void {
    const card = document.createElement('div');
    card.className = 'panel-card';
    card.innerHTML = `
      <h3>🎟️ Chính Sách Giá Vé & Trải Nghiệm Khách Tham Quan</h3>
      <p>Khách tới Cổng Bán Vé phía Nam, mua vé một lần, đi theo đường đá tới Điểm Ngắm Thú / Biển Giáo Dục ở khoảng cách an toàn rồi ra về. Giá vé hợp lý (10đ – 25đ) giúp duy trì dòng khách ổn định.</p>
      <div class="sim-box">
        <strong>Giá vé hiện tại: <span id="lbl-ticket-price">${this.profile.ticketPrice}</span> đ / lượt</strong>
        <input id="slider-ticket-price" type="range" min="5" max="40" step="1" value="${this.profile.ticketPrice}" style="width:100%; margin-top:6px;" />
        <small>${
          this.profile.ticketPrice <= 20
            ? '💚 Giá vé thân thiện cộng đồng — Khách hài lòng cao.'
            : this.profile.ticketPrice <= 30
            ? '⚖️ Giá vé trung bình — Cần phúc lợi thú và biển giáo dục tốt.'
            : '⚠️ Giá vé quá cao — Khách tham quan sẽ giảm mạnh!'
        }</small>
      </div>
    `;
    container.appendChild(card);

    const slider = card.querySelector('#slider-ticket-price') as HTMLInputElement;
    const lbl = card.querySelector('#lbl-ticket-price')!;
    slider.addEventListener('input', () => {
      this.profile.ticketPrice = Number(slider.value);
      lbl.textContent = String(this.profile.ticketPrice);
      this.updateHud();
      this.saveNow();
    });

    // Staff Auto-care toggle
    const staffCard = document.createElement('div');
    staffCard.className = 'panel-card';
    staffCard.innerHTML = `
      <h3>🧑‍⚕️ Nhân Viên Cứu Hộ & Chăm Sóc Tự Động (Idle / AFK)</h3>
      <p>Nhân viên kiểm lâm tự động tiếp thức ăn khi cá thể đói (chi phí 6đ/lần) nếu cổng tiếp cận khu nuôi không bị chặn, đồng thời bảo vệ thú an toàn khi bạn nghỉ (AFK tối đa 4 giờ).</p>
    `;
    const btnToggleStaff = document.createElement('button');
    btnToggleStaff.className = this.profile.staffAutoCareEnabled ? 'btn-primary btn-sm' : 'btn-secondary btn-sm';
    btnToggleStaff.textContent = this.profile.staffAutoCareEnabled
      ? '✅ Đang BẬT Nhân viên tự động chăm sóc'
      : '⏸️ Đang TẮT Nhân viên tự động chăm sóc';
    btnToggleStaff.addEventListener('click', () => {
      this.profile.staffAutoCareEnabled = !this.profile.staffAutoCareEnabled;
      this.saveNow();
      this.renderActiveDrawer();
    });
    staffCard.appendChild(btnToggleStaff);
    container.appendChild(staffCard);

    // Real Financial Ledger
    const ledgerCard = document.createElement('div');
    ledgerCard.className = 'panel-card';
    ledgerCard.innerHTML = `
      <h3>📊 Báo Cáo Kinh Tế & Giáo Dục Cộng Đồng</h3>
      <div class="stat-bars">
        <div class="stat-bar-item">👥 Tổng lượt khách: <strong>${this.profile.stats.totalVisitorsServed}</strong></div>
        <div class="stat-bar-item">📖 Khách đọc biển bảo tồn: <strong>${this.profile.stats.totalVisitorsEducated}</strong></div>
        <div class="stat-bar-item">🎟️ Thu bán vé: <strong>+${this.profile.stats.totalTicketRevenue} đ</strong></div>
        <div class="stat-bar-item">🥤 Thu quầy dịch vụ: <strong>+${this.profile.stats.totalServiceRevenue} đ</strong></div>
        <div class="stat-bar-item">🍎 Chi chăm sóc & thú y: <strong>-${this.profile.stats.totalCareExpenses} đ</strong></div>
        <div class="stat-bar-item">😊 Độ hài lòng khách: <strong>${Math.round(this.profile.stats.visitorSatisfaction)}%</strong></div>
      </div>
      <p style="margin-top:6px;"><em>Lưu ý đạo đức:</em> Vườn hoàn toàn không có quảng cáo trả phí, không bán thú và không thưởng cho việc nhồi nhét nhiều cá thể vào khu nuôi hẹp.</p>
    `;
    container.appendChild(ledgerCard);
  }

  private renderSpeciesPanel(container: HTMLElement): void {
    const intro = document.createElement('div');
    intro.className = 'science-box';
    intro.innerHTML = `
      <strong>🔬 Nguyên tắc Dữ liệu Khoa học Chính xác:</strong><br/>
      • Phân biệt rõ <strong>Dữ kiện khoa học thực tế (IUCN Red List)</strong> và <strong>Thông số mô phỏng trong game</strong>.<br/>
      • Không gán nhãn "nguy cấp" chung cho mọi loài; chỉ ghi đúng phân hạng IUCN kèm link nguồn và ngày tra cứu (<code>2026-10-25</code>).<br/>
      • Các loài nguy cấp tại Việt Nam chưa có model 3D trong gói Quaternius được trình bày ở mục <em>"Tìm hiểu loài cần bảo vệ"</em> và ghi rõ chưa hiện diện trong khu nuôi.
    `;
    container.appendChild(intro);

    const allIds = Object.keys(SPECIES_DATABASE) as AllSpeciesId[];
    for (const id of allIds) {
      const s = SPECIES_DATABASE[id];
      const badgeClass =
        s.iucnStatusCode === 'CR'
          ? 'tag-cr'
          : s.iucnStatusCode === 'EN'
          ? 'tag-en'
          : 'tag-lc';

      const card = document.createElement('div');
      card.className = 'panel-card';
      card.innerHTML = `
        <h3>
          <span>${s.presentInPark ? '🦌' : '🛡️'} ${s.vietnameseName} (<em>${s.scientificName}</em>)</span>
          <span class="tag-badge ${badgeClass}">IUCN: ${s.iucnStatusCode}</span>
        </h3>
        <p><strong>Trạng thái hiện diện:</strong> ${
          s.presentInPark
            ? '✅ Có mặt trong Khu Cứu Hộ 3D (Model Quaternius CC0 đúng ngoại hình)'
            : '📚 Chuyên mục "Tìm hiểu loài cần bảo vệ" — Chưa hiện diện trong khu nuôi 3D'
        }</p>

        <div class="science-box">
          <strong>🌍 DỮ KIỆN KHOA HỌC (IUCN Red List):</strong><br/>
          • <strong>Phân hạng bảo tồn:</strong> ${s.iucnStatusLabel}<br/>
          • <strong>Sinh cảnh tự nhiên:</strong> ${s.naturalHabitat}<br/>
          • <strong>Thức ăn tự nhiên:</strong> ${s.naturalDiet}<br/>
          • <strong>Tập tính sinh học:</strong> ${s.naturalBehavior}<br/>
          • <strong>Mối đe dọa chính:</strong> ${s.mainThreats}<br/>
          • <strong>Hành động bảo vệ thiết thực:</strong> ${s.humanActions}<br/>
          • <strong>Nguồn kiểm chứng:</strong> <a class="source-link" href="${s.sourceUrl}" target="_blank" rel="noopener noreferrer">${s.sourceTitle}</a> (Tra cứu ngày: <code>${s.lookupDate}</code>)<br/>
          • <strong>Điều kiện dữ liệu & Model:</strong> ${s.modelNote}
        </div>

        ${
          s.simulationTargets
            ? `<div class="sim-box">
                <strong>🎮 THÔNG SỐ MÔ PHỎNG TRONG GAME (Đơn giản hóa):</strong><br/>
                • Khu nuôi phù hợp: ${HABITAT_ZONES[s.preferredZone!].name}<br/>
                • Mục tiêu cảnh quan khu nuôi: Tối thiểu ${s.simulationTargets.minTrees} cây xanh, ${s.simulationTargets.minWater} hồ nước, ${s.simulationTargets.minShelter} chỗ trú, ${s.simulationTargets.minEnrichment} đồ làm giàu, độ yên tĩnh ≥ ${s.simulationTargets.minQuietness}%.
              </div>`
            : ''
        }
      `;
      container.appendChild(card);
    }
  }

  private renderReleasePanel(container: HTMLElement): void {
    const disclaimer = document.createElement('div');
    disclaimer.className = 'warn-box';
    disclaimer.innerHTML = `
      <strong>⚠️ Lưu ý Khoa học & Đạo đức Bảo tồn:</strong> Quy trình đánh giá và tái thả trong game đã được đơn giản hóa để phục vụ trải nghiệm giáo dục (10–15 phút), <strong>không phải hướng dẫn cứu hộ thực địa ngoài đời</strong>. Tái thả là sứ mệnh bảo tồn phi lợi nhuận (không bán thú lấy vàng, không nhận thưởng lặp từ cùng một cá thể).
    `;
    container.appendChild(disclaimer);

    // 1. Evaluate currently cared animals for release
    for (const animal of this.profile.animals) {
      const species = SPECIES_DATABASE[animal.speciesId];
      const check = evaluateReleaseEligibility(animal);

      const card = document.createElement('div');
      card.className = 'panel-card';
      card.innerHTML = `
        <h3>
          <span>🐾 ${animal.name} (${animal.code}) — ${species.vietnameseName}</span>
          <span class="tag-badge ${check.eligible ? 'tag-lc' : 'tag-en'}">${
        check.eligible ? 'Đủ điều kiện Tái thả' : 'Đang phục hồi / Lưu trú'
      }</span>
        </h3>
        <div class="sim-box">
          <strong>Bảng kiểm điều kiện tái thả tự nhiên:</strong><br/>
          ${check.notPermanentHold ? '✅' : '❌'} Không thuộc diện di chứng cần chăm sóc lâu dài<br/>
          ${check.healthOk ? '✅' : '⏳'} Sức khỏe ≥ 85% (Hiện tại: ${Math.round(animal.health)}%)<br/>
          ${check.comfortOk ? '✅' : '⏳'} Mức thoải mái khu nuôi ≥ 75% (Hiện tại: ${Math.round(animal.comfort)}%)<br/>
          ${check.rehabOk ? '✅' : '⏳'} Tiến độ phục hồi đạt 100% (Hiện tại: ${Math.round(animal.rehabProgress)}%)<br/>
          ${check.wildReadinessOk ? '✅' : '⏳'} Kỹ năng tự sống ngoài tự nhiên ≥ 85% (Hiện tại: ${Math.round(animal.wildReadiness)}%)
        </div>
        ${
          !check.eligible
            ? `<p style="color:#fcd34d"><em>Lý do chưa thể tái thả:</em> ${check.reasons.join(' ')}</p>`
            : `<p style="color:#6ee7b7">🎉 Cá thể đã hồi phục hoàn toàn! Hãy chọn sinh cảnh tiếp nhận phù hợp để tiến hành tái thả.</p>`
        }
      `;

      if (check.eligible) {
        const btnOpenReleaseModal = document.createElement('button');
        btnOpenReleaseModal.className = 'btn-primary btn-sm';
        btnOpenReleaseModal.textContent = `🕊️ Chọn Sinh Cảnh & Xác Nhận Tái Thả ${animal.name}`;
        btnOpenReleaseModal.addEventListener('click', () => {
          this.showReleaseConfirmationModal(animal);
        });
        card.appendChild(btnOpenReleaseModal);
      }

      container.appendChild(card);
    }

    // 2. Conservation Release Ledger & Wild Telemetry Updates
    const logHeader = document.createElement('h3');
    logHeader.style.fontSize = '14px';
    logHeader.style.color = '#6ee7b7';
    logHeader.style.marginTop = '8px';
    logHeader.textContent = `📡 Sổ Bảo Tồn & Tin Nhắn Theo Dõi Sau Tái Thả (${this.profile.releasedRecords.length})`;
    container.appendChild(logHeader);

    if (this.profile.releasedRecords.length === 0) {
      const empty = document.createElement('p');
      empty.style.fontSize = '12px';
      empty.style.color = '#94a3b8';
      empty.textContent = 'Chưa có cá thể nào được tái thả trong hồ sơ vườn này.';
      container.appendChild(empty);
    }

    for (const rec of this.profile.releasedRecords) {
      const species = SPECIES_DATABASE[rec.speciesId];
      const card = document.createElement('div');
      card.className = 'panel-card';
      card.innerHTML = `
        <h3>
          <span>🕊️ ${rec.name} (${rec.code}) — ${species.vietnameseName}</span>
          <span class="tag-badge tag-lc">+${rec.reputationAwarded} Uy tín</span>
        </h3>
        <p><strong>Nơi tái thả:</strong> ${rec.releaseHabitatName}</p>
        <p><strong>Thời gian tái thả:</strong> ${new Date(rec.releasedAtIso).toLocaleString('vi-VN')}</p>
        <div class="science-box">
          <strong>Nhật ký Tín hiệu Vòng cổ GPS ngoài tự nhiên:</strong>
          ${rec.followUpUpdates
            .map(
              (u) => `
              <div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(148,163,184,0.3);">
                <strong>${u.title}</strong> <small>(${u.collarSignalStrength})</small><br/>
                <span>${u.message}</span>
              </div>
            `
            )
            .join('')}
        </div>
      `;
      container.appendChild(card);
    }
  }

  private showReleaseConfirmationModal(animal: RescuedAnimal): void {
    const species = SPECIES_DATABASE[animal.speciesId];
    const habitats = species.releaseHabitats || [];

    const overlay = document.getElementById('modal-overlay')!;
    const titleEl = document.getElementById('modal-title')!;
    const contentEl = document.getElementById('modal-content')!;

    titleEl.textContent = `🕊️ Xác Nhận Quy Trình Tái Thả Tự Nhiên — ${animal.name} (${animal.code})`;
    let selectedHabitatId = '';

    contentEl.innerHTML = `
      <div class="warn-box">
        <strong>Xác nhận quan trọng:</strong> Sau khi tái thả về tự nhiên, cá thể <strong>${animal.name} (${animal.code})</strong> sẽ <strong>rời khỏi khu nuôi của vườn vĩnh viễn</strong> và chuyển sang Sổ Theo Dõi Tự Nhiên. Bạn chỉ nhận điểm Uy tín bảo tồn một lần duy nhất cho mỗi cá thể.
      </div>
      <p><strong>Bước 1: Chọn sinh cảnh tiếp nhận phù hợp với sinh thái học của ${species.vietnameseName} (<em>${species.scientificName}</em>):</strong></p>
      <div id="habitat-choices" style="display:flex; flex-direction:column; gap:8px;"></div>
      <div id="habitat-feedback" class="science-box">Hãy chọn một vùng sinh cảnh bên trên để kiểm tra mức độ tương thích.</div>
      <div class="action-row" style="justify-content:flex-end; margin-top:8px;">
        <button id="btn-modal-cancel-release" class="btn-secondary">Hủy bỏ</button>
        <button id="btn-modal-confirm-release" class="btn-primary" disabled>🕊️ Xác Nhận Tái Thả Về Tự Nhiên</button>
      </div>
    `;

    const choicesDiv = contentEl.querySelector('#habitat-choices')!;
    const feedbackDiv = contentEl.querySelector('#habitat-feedback')!;
    const confirmBtn = contentEl.querySelector('#btn-modal-confirm-release') as HTMLButtonElement;

    for (const h of habitats) {
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.style.textAlign = 'left';
      btn.textContent = `🌲 ${h.name}`;
      btn.addEventListener('click', () => {
        selectedHabitatId = h.id;
        if (h.suitable) {
          feedbackDiv.innerHTML = `<strong style="color:#6ee7b7">✅ Sinh cảnh ĐẠT CHUẨN:</strong> ${h.reason}`;
          confirmBtn.disabled = false;
        } else {
          feedbackDiv.innerHTML = `<strong style="color:#fca5a5">❌ Sinh cảnh KHÔNG AN TOÀN:</strong> ${h.reason}`;
          confirmBtn.disabled = true;
        }
      });
      choicesDiv.appendChild(btn);
    }

    contentEl.querySelector('#btn-modal-cancel-release')!.addEventListener('click', () => {
      overlay.classList.add('hidden');
    });

    confirmBtn.addEventListener('click', () => {
      const chosen = habitats.find((h) => h.id === selectedHabitatId);
      if (!chosen || !chosen.suitable) return;
      overlay.classList.add('hidden');
      this.executeAnimalRelease(animal.id, chosen.name);
    });

    overlay.classList.remove('hidden');
  }

  public executeAnimalRelease(animalId: string, releaseHabitatName: string): void {
    const idx = this.profile.animals.findIndex((a) => a.id === animalId);
    if (idx < 0) return;
    const animal = this.profile.animals[idx];

    // Prevent any duplicate release reward by ensuring ID/code is not already in releasedRecords
    if (this.profile.releasedRecords.some((r) => r.id === animal.id || r.code === animal.code)) {
      this.showToast('⚠️ Cá thể này đã được ghi nhận trong Sổ Tái Thả.');
      return;
    }

    // Trigger 3D release celebration particles before removing animal from enclosure
    this.scene3d.triggerReleaseEffect(animal);
    this.profile.animals.splice(idx, 1);

    const repAward = 35;
    this.profile.conservationReputation += repAward;

    const nowIso = new Date().toISOString();
    const record: ReleasedAnimalRecord = {
      id: animal.id,
      code: animal.code,
      name: animal.name,
      speciesId: animal.speciesId,
      releasedAtIso: nowIso,
      releaseHabitatName,
      finalHealth: Math.round(animal.health),
      finalComfort: Math.round(animal.comfort),
      reputationAwarded: repAward,
      followUpStage: 0,
      nextFollowUpAtMs: Date.now() + 12000, // First wild GPS update arrives in 12s
      followUpUpdates: [
        {
          id: 'upd_init_' + Date.now(),
          timestampIso: nowIso,
          title: `🕊️ Đã mở lồng tái thả tại ${releaseHabitatName}`,
          message: `Cá thể ${animal.name} (${animal.code}) đã rời vườn cứu hộ an toàn, bước vào sinh cảnh tự nhiên với vòng cổ định vị sinh thái.`,
          collarSignalStrength: 'Khởi tạo (GPS 100%)',
        },
      ],
    };

    this.profile.releasedRecords.unshift(record);
    this.scene3d.syncAnimals(this.profile);
    this.updateHud();
    this.saveNow();
    if (this.activePanel) this.renderActiveDrawer();
    this.showToast(`🕊️ Tái thả thành công ${animal.name} về ${releaseHabitatName}! (+${repAward} Uy tín bảo tồn)`);
  }

  private renderProfilesPanel(container: HTMLElement): void {
    const notice = document.createElement('div');
    notice.className = 'warn-box';
    notice.innerHTML = `
      <strong>🔒 Lưu Trữ Cục Bộ Riêng Biệt:</strong><br/>
      • Bản thử lưu trực tiếp trên thiết bị/trình duyệt bằng khóa lưu riêng (<code>idle_zoo_3d_sanctuary_*</code>), hoàn toàn tách biệt với mọi game khác.<br/>
      • <strong>Chưa có hệ thống tài khoản đăng nhập và chưa đồng bộ đám mây đa thiết bị.</strong> Bạn có thể dùng tính năng Xuất/Nhập JSON bên dưới để sao lưu thủ công.
    `;
    container.appendChild(notice);

    // Current Profile Rename & Create New Profile
    const createCard = document.createElement('div');
    createCard.className = 'panel-card';
    createCard.innerHTML = `
      <h3>➕ Tạo Hồ Sơ Vườn Mới Độc Lập</h3>
      <p>Mỗi hồ sơ có mã ID riêng, tiền, công trình, cá thể cứu hộ và sổ tái thả hoàn toàn độc lập.</p>
    `;
    const newRow = document.createElement('div');
    newRow.className = 'action-row';
    const inputNewName = document.createElement('input');
    inputNewName.id = 'input-new-profile-name';
    inputNewName.className = 'input-text';
    inputNewName.style.flex = '1';
    inputNewName.placeholder = 'Nhập tên vườn cứu hộ mới...';
    const btnCreate = document.createElement('button');
    btnCreate.id = 'btn-create-profile';
    btnCreate.className = 'btn-primary btn-sm';
    btnCreate.textContent = '🌱 Tạo & Chuyển sang Vườn Mới';
    btnCreate.addEventListener('click', () => {
      const name = inputNewName.value.trim() || `Vườn Bảo Tồn #${SaveManager.listProfiles().length + 1}`;
      this.saveNow();
      this.profile = SaveManager.createNewProfile(name);
      this.scene3d.rebuildWorldFromProfile(this.profile);
      this.updateHud();
      this.renderActiveDrawer();
      this.showToast(`🌱 Đã tạo hồ sơ mới: "${this.profile.parkName}" (${this.profile.profileId}).`);
    });
    newRow.appendChild(inputNewName);
    newRow.appendChild(btnCreate);
    createCard.appendChild(newRow);
    container.appendChild(createCard);

    // List existing profiles
    const listCard = document.createElement('div');
    listCard.className = 'panel-card';
    listCard.innerHTML = `<h3>📂 Danh Sách Hồ Sơ Vườn Trên Trình Duyệt</h3>`;
    const profiles = SaveManager.listProfiles();
    for (const meta of profiles) {
      const isCurrent = meta.profileId === this.profile.profileId;
      const itemDiv = document.createElement('div');
      itemDiv.className = 'sim-box';
      itemDiv.style.display = 'flex';
      itemDiv.style.alignItems = 'center';
      itemDiv.style.justifyContent = 'space-between';
      itemDiv.style.gap = '8px';
      itemDiv.innerHTML = `
        <div>
          <strong>${meta.parkName}</strong> ${isCurrent ? '<span class="tag-badge tag-lc">Đang mở</span>' : ''}<br/>
          <small>ID: <code>${meta.profileId}</code> • 🪙 ${meta.money}đ • 🌿 ${meta.reputation} điểm • 🐾 ${meta.animalCount} nuôi / ${meta.releasedCount} thả</small>
        </div>
      `;
      if (!isCurrent) {
        const btnSwitch = document.createElement('button');
        btnSwitch.className = 'btn-secondary btn-sm';
        btnSwitch.textContent = 'Chuyển hồ sơ';
        btnSwitch.addEventListener('click', () => {
          this.switchProfile(meta.profileId);
        });
        itemDiv.appendChild(btnSwitch);
      }
      listCard.appendChild(itemDiv);
    }
    container.appendChild(listCard);

    // Export / Import JSON with validation & confirmation
    const ioCard = document.createElement('div');
    ioCard.className = 'panel-card';
    ioCard.innerHTML = `
      <h3>📦 Xuất / Nhập Dữ Liệu JSON (Phiên bản Save v${this.profile.saveVersion})</h3>
      <p>Kiểm tra cấu trúc dữ liệu trước khi nhập và yêu cầu xác nhận trước khi ghi đè hồ sơ.</p>
    `;
    const ioTextArea = document.createElement('textarea');
    ioTextArea.id = 'textarea-save-json';
    ioTextArea.className = 'input-text';
    ioTextArea.rows = 5;
    ioTextArea.value = SaveManager.exportProfileJson(this.profile);

    const ioBtnRow = document.createElement('div');
    ioBtnRow.className = 'action-row';

    const btnCopyJson = document.createElement('button');
    btnCopyJson.className = 'btn-secondary btn-sm';
    btnCopyJson.textContent = '📋 Sao chép / Tải file JSON';
    btnCopyJson.addEventListener('click', () => {
      const jsonStr = SaveManager.exportProfileJson(this.profile);
      ioTextArea.value = jsonStr;
      navigator.clipboard?.writeText(jsonStr).catch(() => {});
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.profile.profileId}_backup.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('📦 Đã xuất dữ liệu JSON của hồ sơ vườn hiện tại.');
    });

    const btnImportJson = document.createElement('button');
    btnImportJson.id = 'btn-import-json';
    btnImportJson.className = 'btn-primary btn-sm';
    btnImportJson.textContent = '📥 Kiểm tra & Nhập JSON từ ô trên';
    btnImportJson.addEventListener('click', () => {
      this.validateAndConfirmImportJson(ioTextArea.value);
    });

    ioBtnRow.appendChild(btnCopyJson);
    ioBtnRow.appendChild(btnImportJson);
    ioCard.appendChild(ioTextArea);
    ioCard.appendChild(ioBtnRow);
    container.appendChild(ioCard);
  }

  public switchProfile(targetProfileId: string): void {
    this.saveNow();
    const loaded = SaveManager.loadProfile(targetProfileId);
    if (!loaded.profile) {
      this.showToast(`⚠️ Không thể tải hồ sơ: ${loaded.error || 'Không tìm thấy'}`);
      return;
    }
    this.profile = loaded.profile;
    SaveManager.setActiveProfileId(this.profile.profileId);
    const afk = calculateAndApplyAfkProgress(this.profile, Date.now());
    this.saveNow();
    this.scene3d.rebuildWorldFromProfile(this.profile);
    this.updateHud();
    if (this.activePanel) this.renderActiveDrawer();
    this.showToast(`📂 Đã chuyển sang hồ sơ "${this.profile.parkName}".`);
    if (afk) this.showAfkReportModal(afk);
  }

  private validateAndConfirmImportJson(rawJson: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      this.showToast('❌ Lỗi cú pháp JSON! Dữ liệu hiện tại được giữ nguyên an toàn.');
      return;
    }

    const check = SaveManager.validateProfileData(parsed);
    if (!check.valid || !check.profile) {
      this.showToast(`❌ Dữ liệu JSON không hợp lệ: ${check.error}`);
      return;
    }

    const candidate = check.profile;
    const overlay = document.getElementById('modal-overlay')!;
    const titleEl = document.getElementById('modal-title')!;
    const contentEl = document.getElementById('modal-content')!;

    titleEl.textContent = '📥 Xác Nhận Nhập & Ghi Đè Hồ Sơ Vườn';
    contentEl.innerHTML = `
      <div class="science-box">
        <strong>Kiểm tra tính toàn vẹn dữ liệu JSON thành công (Save v${candidate.saveVersion}):</strong><br/>
        • Tên vườn: <strong>${candidate.parkName}</strong> (ID: <code>${candidate.profileId}</code>)<br/>
        • Kinh phí: <strong>${Math.round(candidate.money)} đ</strong> • Uy tín: <strong>${Math.round(candidate.conservationReputation)} điểm</strong><br/>
        • Số công trình: <strong>${candidate.placedItems.length}</strong> • Cá thể đang nuôi: <strong>${candidate.animals.length}</strong> • Đã tái thả: <strong>${candidate.releasedRecords.length}</strong>
      </div>
      <div class="warn-box">
        Bạn có chắc chắn muốn nhập dữ liệu này và áp dụng vào trình duyệt không?
      </div>
      <div class="action-row" style="justify-content:flex-end;">
        <button id="btn-cancel-import" class="btn-secondary">Hủy</button>
        <button id="btn-confirm-import" class="btn-primary">✅ Xác Nhận Nhập Hồ Sơ</button>
      </div>
    `;

    contentEl.querySelector('#btn-cancel-import')!.addEventListener('click', () => {
      overlay.classList.add('hidden');
    });
    contentEl.querySelector('#btn-confirm-import')!.addEventListener('click', () => {
      overlay.classList.add('hidden');
      this.profile = candidate;
      this.profile.lastActiveAtMs = Date.now();
      this.profile.lastAfkClaimedAtMs = Date.now();
      this.saveNow();
      this.scene3d.rebuildWorldFromProfile(this.profile);
      this.updateHud();
      if (this.activePanel) this.renderActiveDrawer();
      this.showToast(`✅ Đã khôi phục hồ sơ vườn "${this.profile.parkName}" thành công!`);
    });

    overlay.classList.remove('hidden');
  }

  private showViewingEducationModal(zoneId: HabitatZoneId): void {
    const zone = HABITAT_ZONES[zoneId];
    const species = SPECIES_DATABASE[zone.speciesId];
    const welfare = evaluateZoneWelfare(this.profile, zoneId);

    const overlay = document.getElementById('modal-overlay')!;
    const titleEl = document.getElementById('modal-title')!;
    const contentEl = document.getElementById('modal-content')!;

    titleEl.textContent = `🪧 Biển Giáo Dục Tại Điểm Ngắm — ${species.vietnameseName}`;
    contentEl.innerHTML = `
      <div class="science-box">
        <strong>📌 Thông tin Khoa học & Bảo tồn (IUCN Red List):</strong><br/>
        • <strong>Tên Việt / Khoa học:</strong> ${species.vietnameseName} (<em>${species.scientificName}</em>)<br/>
        • <strong>Phân hạng IUCN:</strong> ${species.iucnStatusLabel}<br/>
        • <strong>Nơi sống tự nhiên:</strong> ${species.naturalHabitat}<br/>
        • <strong>Thức ăn:</strong> ${species.naturalDiet}<br/>
        • <strong>Tập tính:</strong> ${species.naturalBehavior}<br/>
        • <strong>Mối đe dọa:</strong> ${species.mainThreats}<br/>
        • <strong>Chúng ta có thể làm gì?</strong> ${species.humanActions}<br/>
        • <strong>Nguồn:</strong> <a class="source-link" href="${species.sourceUrl}" target="_blank" rel="noopener noreferrer">${species.sourceTitle}</a> (Tra cứu: ${species.lookupDate})
      </div>
      <div class="sim-box">
        <strong>👀 Trạng thái Điểm Ngắm & Khoảng Cách Quan Sát:</strong><br/>
        • Điểm ngắm đặt ngoài hàng rào ở khoảng cách an toàn để không gây căng thẳng cho thú.<br/>
        • Kết nối đường đi từ cổng: ${welfare.visitorViewingConnected ? '✅ Đã kết nối' : '❌ Chưa nối đường đá'}<br/>
        • Biển giáo dục bảo tồn: ${welfare.hasEducationSign ? '✅ Đã lắp đặt (+Uy tín khi khách đọc)' : '⚠️ Chưa đặt Biển Giáo Dục tại điểm ngắm này'}
      </div>
    `;
    overlay.classList.remove('hidden');
  }

  private showAfkReportModal(report: AfkReport): void {
    const overlay = document.getElementById('modal-overlay')!;
    const titleEl = document.getElementById('modal-title')!;
    const contentEl = document.getElementById('modal-content')!;

    const mins = Math.floor(report.cappedSeconds / 60);
    const secs = report.cappedSeconds % 60;

    titleEl.textContent = '⏳ Báo Cáo Hoạt Động Khi Bạn Vắng Mặt (Idle / AFK)';
    contentEl.innerHTML = `
      <div class="sim-box">
        <strong>Thời gian nghỉ thực tế được tính:</strong> ${mins} phút ${secs} giây ${
      report.wasCapped ? '(Đã giới hạn tối đa 4 giờ theo quy định)' : ''
    }<br/>
        • 👥 Lượt khách tham quan: <strong>+${report.visitorsEstimated} lượt</strong><br/>
        • 🎟️ Thu nhập bán vé: <strong>+${report.ticketIncome} đ</strong><br/>
        • 🥤 Thu nhập dịch vụ xanh: <strong>+${report.serviceIncome} đ</strong><br/>
        • 🧑‍⚕️ Chi phí nhân viên chăm sóc thú: <strong>-${report.staffCareCost} đ</strong><br/>
        • 💰 Chênh lệch ngân quỹ ròng: <strong>${report.netBalanceChange >= 0 ? '+' : ''}${report.netBalanceChange} đ</strong>
      </div>
      <div class="science-box">
        💚 <strong>Đảm bảo phúc lợi nhân đạo:</strong> Toàn bộ ${report.animalsCaredCount} cá thể trong vườn đều được nhân viên theo dõi an toàn, không có cá thể nào bị bỏ đói nguy kịch hoặc mất vĩnh viễn khi người chơi nghỉ.
      </div>
    `;
    overlay.classList.remove('hidden');
  }

  public showToast(msg: string): void {
    const container = document.getElementById('toast-container')!;
    while (container.children.length >= 2) {
      container.firstElementChild?.remove();
    }
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3500);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new IdleZooApp();
  app.init();
});
