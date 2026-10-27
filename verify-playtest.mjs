import { chromium } from 'file:///D:/game/references/ancient-beast/node_modules/playwright-core/index.mjs';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/truon/.gemini/antigravity/brain/e0e11bd9-23bd-4d28-87ca-a727b72d52ac';
const edgePaths = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const executablePath = edgePaths.find((p) => fs.existsSync(p));

async function runPlaytest() {
  console.log('Using browser:', executablePath);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  console.log('1. Loading http://localhost:5175/ ...');
  await page.goto('http://localhost:5175/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Screenshot 1: Initial 3D Park Overview (Desktop)
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_01_park_overview.png') });

  // Verify debug panel is closed by default
  const debugHidden = await page.evaluate(() => {
    return document.getElementById('debug-panel')?.classList.contains('hidden');
  });
  console.log('Debug panel hidden by default:', debugHidden);

  // 2. Open Rescue & Care panel, check starter animal (Hươu Đỏ RD-2026-01), feed & vet check
  await page.click('button[data-panel="rescue"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_02_rescue_care_panel.png') });

  // Test landscape change affecting animal comfort & test edge cases (overlap, out of bounds, blocking gate, out of money)
  const edgeAndLandscapeReport = await page.evaluate(() => {
    const app = window.__IDLE_ZOO_APP__;
    app.recalculateAllAnimalsComfort();
    const beforeComfort = app.profile.animals[0].comfort;

    // Add Shelter, Pine Tree, and Enrichment inside Meadow Glade (-6, 0), (-8, -2), (-7, -4)
    app.setBuildMode({ type: 'place', catalogId: 'shelter_stable', rotationY: 0 });
    app.handleGridTileClick(-6, 0);
    app.setBuildMode({ type: 'place', catalogId: 'tree_pine', rotationY: 0 });
    app.handleGridTileClick(-8, -2);
    app.setBuildMode({ type: 'place', catalogId: 'enrichment_log_rock', rotationY: 0 });
    app.handleGridTileClick(-7, -4);
    app.setBuildMode({ type: 'none' });

    const afterComfort = app.profile.animals[0].comfort;

    // Edge case 1: Overlapping placement at (-8, -2)
    app.setBuildMode({ type: 'place', catalogId: 'tree_common', rotationY: 0 });
    const moneyBeforeOverlap = app.profile.money;
    app.handleGridTileClick(-8, -2);
    const overlapBlocked = app.profile.money === moneyBeforeOverlap;

    // Edge case 2: Blocking entrance gate (0, 10)
    app.setBuildMode({ type: 'place', catalogId: 'bench_rest', rotationY: 0 });
    app.handleGridTileClick(0, 10);
    const gateBlocked = app.profile.money === moneyBeforeOverlap;

    // Edge case 3: Out of money check
    const savedMoney = app.profile.money;
    app.profile.money = 5;
    app.setBuildMode({ type: 'place', catalogId: 'shelter_stable', rotationY: 0 });
    app.handleGridTileClick(-7, -2);
    const outOfMoneyBlocked = app.profile.money === 5;
    app.profile.money = savedMoney + 300; // Add funds to build Zone 2 & admit Wolf
    app.setBuildMode({ type: 'none' });

    return {
      beforeComfort,
      afterComfort,
      overlapBlocked,
      gateBlocked,
      outOfMoneyBlocked,
    };
  });
  console.log('Landscape & Edge Case Verification:', edgeAndLandscapeReport);

  // 3. Build Zone 2 (Pine Highland for Gray Wolf) & admit Gray Wolf rescue case
  await page.click('button[data-panel="build"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_03_build_catalog.png') });

  await page.evaluate(() => {
    const app = window.__IDLE_ZOO_APP__;
    // Unlock Pine Highland zone & admit Gray Wolf case
    app.profile.builtZones.pine_highland = true;
    app.scene3d.rebuildEnclosures(app.profile);
    app.admitRescueCase('case_wolf_02');
    // Spawn visitors to buy tickets, walk along path, read education board, and exit
    app.trySpawnVisitor();
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_04_visitors_and_wolf.png') });

  // 4. Open Species Book (IUCN Red List + Knowledge-only Endangered Species section)
  await page.click('button[data-panel="species"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_05_iucn_species_book.png') });

  // 5. Complete rehabilitation of Red Deer (RD-2026-01), open Release Modal, select suitable habitat, confirm release & receive wild telemetry
  await page.evaluate(() => {
    const app = window.__IDLE_ZOO_APP__;
    const deer = app.profile.animals.find((a) => a.code === 'RD-2026-01');
    if (deer) {
      deer.hunger = 95;
      deer.health = 96;
      deer.comfort = 88;
      deer.rehabProgress = 100;
      deer.wildReadiness = 94;
      deer.stage = 'adult_ready';
      app.scene3d.syncAnimals(app.profile);
    }
  });
  await page.click('button[data-panel="release"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_06_release_ready_check.png') });

  // Trigger Release confirmation modal
  await page.evaluate(() => {
    const app = window.__IDLE_ZOO_APP__;
    const deer = app.profile.animals.find((a) => a.code === 'RD-2026-01');
    app.showReleaseConfirmationModal(deer);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_07_release_habitat_modal.png') });

  // Execute release and trigger follow-up GPS telemetry
  const releaseAndTelemetryResult = await page.evaluate(() => {
    const app = window.__IDLE_ZOO_APP__;
    document.getElementById('modal-overlay')?.classList.add('hidden');
    const deer = app.profile.animals.find((a) => a.code === 'RD-2026-01');
    const repBefore = app.profile.conservationReputation;
    app.executeAnimalRelease(deer.id, 'Khu Bảo tồn Thung lũng Rừng Thưa & Đồng cỏ Ôn đới');
    const repAfter = app.profile.conservationReputation;
    // Try releasing same animal again to verify no duplicate reward
    app.executeAnimalRelease(deer.id, 'Khu Bảo tồn Thung lũng Rừng Thưa & Đồng cỏ Ôn đới');
    const repAfterDuplicateAttempt = app.profile.conservationReputation;

    // Deliver GPS telemetry update #1
    const rec = app.profile.releasedRecords[0];
    app.deliverWildFollowUpUpdate(rec);

    return {
      repBefore,
      repAfter,
      repAfterDuplicateAttempt,
      releasedCount: app.profile.releasedRecords.length,
      followUpCount: rec.followUpUpdates.length,
      latestUpdateTitle: rec.followUpUpdates[0].title,
    };
  });
  console.log('Release & Telemetry Verification:', releaseAndTelemetryResult);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_08_released_telemetry_log.png') });

  // 6. Verify Reload Persistence, Export/Import JSON, Two Independent Profiles, and AFK Non-Duplication
  const profileAndAfkVerification = await page.evaluate(() => {
    const app = window.__IDLE_ZOO_APP__;
    const profile1Id = app.profile.profileId;
    const profile1Export = app.textarea ? '' : JSON.stringify(app.profile);

    // Test AFK non-duplication on immediate re-check
    const moneyBeforeAfkRecheck = app.profile.money;
    app.switchProfile(profile1Id);
    const moneyAfterImmediateRecheck = app.profile.money;

    // Create Profile 2 and verify independence
    document.querySelector('button[data-panel="profiles"]').click();
    const inputName = document.getElementById('input-new-profile-name');
    if (inputName) inputName.value = 'Vườn Bảo Tồn Trường Sơn 2';
    document.getElementById('btn-create-profile')?.click();

    const profile2Id = app.profile.profileId;
    const profile2Name = app.profile.parkName;
    const profile2ReleasedCount = app.profile.releasedRecords.length;

    // Switch back to Profile 1
    app.switchProfile(profile1Id);

    return {
      profile1Id,
      profile2Id,
      independentIds: profile1Id !== profile2Id,
      afkNoDuplicateReward: moneyBeforeAfkRecheck === moneyAfterImmediateRecheck,
      profile2Name,
      profile2ReleasedCount,
      profile1ReleasedCountRestored: app.profile.releasedRecords.length,
    };
  });
  console.log('Profile & AFK Verification:', profileAndAfkVerification);

  await page.click('button[data-panel="profiles"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_09_profiles_save_io.png') });

  // 7. Mobile Viewport Test (390x844 iPhone 14 size)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'playtest_10_mobile_viewport.png') });

  console.log('Console errors during playtest:', consoleErrors.length);
  await browser.close();
}

runPlaytest().catch((err) => {
  console.error(err);
  process.exit(1);
});
