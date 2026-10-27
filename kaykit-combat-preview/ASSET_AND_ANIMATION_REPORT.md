# Báo Cáo Kiểm Kê Tài Nguyên KayKit 3D & Bộ 161 Animation Humanoid

- **Thư mục tài nguyên gốc:** `D:\game\references\kaykit`
- **Thư mục bản thử 3D:** `D:\game\kaykit-combat-preview`
- **Cổng chạy bản thử:** `http://localhost:5174/` (tách biệt hoàn toàn với `eclipse-survivors` ở cổng `5173`)

---

## 1. Danh Sách Bộ Tài Nguyên Đã Tải & Giấy Phép

| Bộ tài nguyên | Tác giả / Nguồn chính thức | Đường dẫn lưu trữ | Định dạng | Giấy phép |
|---|---|---|---|---|
| **KayKit Dungeon Pack Remastered (1.1 FREE)** | Kay Lousberg (`https://kaylousberg.itch.io/kaykit-dungeon-remastered`) | `D:\game\references\kaykit\kaykit-dungeon-remastered\KayKit_Dungeon_Pack_1.1_FREE\` | `211` file `.gltf` + `.bin` + `dungeon_texture.png` | **CC0 1.0 Public Domain** (`License.txt` đi kèm) |
| **KayKit Character Animations (1.1 FREE)** | Kay Lousberg (`https://kaylousberg.itch.io/kaykit-character-animations`) | `D:\game\references\kaykit\kaykit-character-animations\KayKit_Character_Animations_1.1\` | `16` file `.glb` (`8` file `Rig_Medium` + `6` file `Rig_Large` + `2` mẫu rig) | **CC0 1.0 Public Domain** (`License.txt` đi kèm) |
| **KayKit Adventurers (2.0 FREE)** | Kay Lousberg (`https://kaylousberg.itch.io/kaykit-adventurers`) | `D:\game\references\kaykit\kaykit-adventurers\KayKit_Adventurers_2.0_FREE\` | `6` tướng `.glb` (`Knight`, `Barbarian`, `Mage`, `Ranger`, `Rogue`, `Rogue_Hooded`) + `31` vũ khí/khiên `.gltf` | **CC0 1.0 Public Domain** (`License.txt` đi kèm) |
| **KayKit Skeletons (1.1 FREE)** | Kay Lousberg (`https://kaylousberg.itch.io/kaykit-skeletons`) | `D:\game\references\kaykit\kaykit-skeletons\KayKit_Skeletons_1.1_FREE\` | `4` quái xương `.glb` (`Skeleton_Warrior`, `Skeleton_Rogue`, `Skeleton_Minion`, `Skeleton_Mage`) + `13` vũ khí `.gltf` | **CC0 1.0 Public Domain** (`License.txt` đi kèm) |
| **Quaternius Companion Pets (Ultimate Animated Animals & Easy Enemies)** | Quaternius (`https://quaternius.com/packs/ultimateanimatedanimals.html` & `easyenemy.html`) | `D:\game\references\kaykit\companion-pets-quaternius\` | `8` thú/sinh vật rigged `.glb` (`Wolf.glb`, `Fox.glb`, `Husky.glb`, `Stag.glb`, `Wasp.glb`, `Spider.glb`, `Snake.glb`, `Frog.glb`) | **CC0 1.0 Public Domain** (`LICENSE.txt` đi kèm) |

---

## 2. Kiểm Kê Chi Tiết Bộ "161 Animation Humanoid" Của KayKit

Đã viết script đọc trực tiếp chunk JSON của toàn bộ file `.glb` trong `KayKit_Character_Animations_1.1\Animations\gltf\`:

### A. Tổng kết số lượng thực tế so với quảng cáo "161 Animations"
- **`Rig_Medium` (8 file GLB):** có **132** tên clip độc lập (gồm **131** động tác + `T-Pose`).
  - Mỗi file GLB đều chứa kèm 1 clip `T-Pose` (tổng số mục trong 8 file là `139`, trừ 7 bản lặp `T-Pose` còn **132** clip).
- **`Rig_Large` (6 file GLB):** có **29** tên clip độc lập (gồm **28** động tác + `T-Pose`).
  - Mỗi file GLB chứa kèm 1 clip `T-Pose` (tổng số mục trong 6 file là `34`, trừ 5 bản lặp `T-Pose` còn **29** clip).
- **Vì sao tác giả ghi "161 animations":** `132 (Rig_Medium) + 29 (Rig_Large) = 161` clip!
- **Khi KHÔNG đếm trùng giữa `Rig_Medium` và `Rig_Large`:**
  - Có **17 clip trùng tên** giữa `Rig_Medium` và `Rig_Large`: `Death_A`, `Death_A_Pose`, `Dodge_Forward`, `Dodge_Left`, `Dodge_Right`, `Hit_A`, `Idle_A`, `Idle_B`, `Melee_2H_Idle`, `Melee_Block`, `Melee_Block_Attack`, `Melee_Block_Hit`, `Melee_Blocking`, `Melee_Unarmed_Idle`, `Running_A`, `T-Pose`, `Walking_A`.
  - Số clip **chỉ có ở `Rig_Medium`**: **115** clip.
  - Số clip **chỉ có ở `Rig_Large`**: **12** clip (`Dodge_Backwards`, `EXPERIMENTAL_Large_Transform`, `Flexing`, `Melee_1H_Slash`, `Melee_1H_Stab`, `Melee_2H_Attack`, `Melee_2H_Slam`, `Melee_Dualwield_Slash`, `Melee_Dualwield_SlashCombo`, `Melee_Unarmed_Kick`, `Melee_Unarmed_Punch`, `Melee_Unarmed_Smash`).
  - **Tổng số tên clip độc lập trên toàn bộ gói (`Rig_Medium ∪ Rig_Large`):** **144** clip (**143** động tác thật + `T-Pose`).

### B. Danh sách tên clip theo từng file trong `Rig_Medium` (132 clip)
1. **`Rig_Medium_MovementBasic.glb` (10 động tác + `T-Pose`):**
   `Idle_A`, `Idle_B`, `Walking_A`, `Walking_B`, `Walking_C`, `Walking_Backwards`, `Running_A`, `Running_B`, `Jump_Full_Short`, `Jump_Full_Long`, `Jump_Start`, `Jump_Idle`, `Jump_Land`, `T-Pose`.
2. **`Rig_Medium_MovementAdvanced.glb` (12 động tác + `T-Pose`):**
   `Crawling`, `Crouching`, `Dodge_Backward`, `Dodge_Forward`, `Dodge_Left`, `Dodge_Right`, `Running_HoldingBow`, `Running_HoldingRifle`, `Running_Strafe_Left`, `Running_Strafe_Right`, `Sneaking`, `Walking_HoldingRifle`, `T-Pose`.
3. **`Rig_Medium_CombatMelee.glb` (21 động tác + `T-Pose`):**
   `Melee_1H_Attack_Chop`, `Melee_1H_Attack_Jump_Chop`, `Melee_1H_Attack_Slice_Diagonal`, `Melee_1H_Attack_Slice_Horizontal`, `Melee_1H_Attack_Stab`, `Melee_2H_Attack_Chop`, `Melee_2H_Attack_Slice`, `Melee_2H_Attack_Spin`, `Melee_2H_Attack_Spinning`, `Melee_2H_Attack_Stab`, `Melee_2H_Idle`, `Melee_Block`, `Melee_Block_Attack`, `Melee_Block_Hit`, `Melee_Blocking`, `Melee_Dualwield_Attack_Chop`, `Melee_Dualwield_Attack_Slice`, `Melee_Dualwield_Attack_Stab`, `Melee_Unarmed_Attack_Kick`, `Melee_Unarmed_Attack_Punch_A`, `Melee_Unarmed_Idle`, `T-Pose`.
4. **`Rig_Medium_CombatRanged.glb` (19 động tác + `T-Pose`):**
   `Ranged_1H_Aiming`, `Ranged_1H_Reload`, `Ranged_1H_Shoot`, `Ranged_1H_Shooting`, `Ranged_2H_Aiming`, `Ranged_2H_Reload`, `Ranged_2H_Shoot`, `Ranged_2H_Shooting`, `Ranged_Bow_Aiming_Idle`, `Ranged_Bow_Draw`, `Ranged_Bow_Draw_Up`, `Ranged_Bow_Release`, `Ranged_Bow_Release_Up`, `Ranged_Magic_Raise`, `Ranged_Magic_Shoot`, `Ranged_Magic_Spellcasting`, `Ranged_Magic_Spellcasting_Long`, `Ranged_Magic_Summon`, `Throw`, `T-Pose`.
5. **`Rig_Medium_General.glb` (14 động tác + `T-Pose`):**
   `Death_A`, `Death_A_Pose`, `Death_B`, `Death_B_Pose`, `Hit_A`, `Hit_B`, `Interact`, `PickUp`, `Spawn_Air`, `Spawn_Ground`, `Throw`, `Use_Item`, `Wave`, `T-Pose`.
6. **`Rig_Medium_Special.glb` (14 động tác + `T-Pose`):**
   `Cheering`, `Push_Ups`, `Sit_Ups`, `Skeletons_Awaken_Floor`, `Skeletons_Awaken_Floor_Long`, `Skeletons_Awaken_Standing`, `Skeletons_Death`, `Skeletons_Death_Pose`, `Skeletons_Death_Resurrect`, `Skeletons_Idle`, `Skeletons_Inactive_Floor_Pose`, `Skeletons_Inactive_Standing_Pose`, `Skeletons_Taunt`, `Skeletons_Walking`, `Taunt`, `Taunt_Longer`, `T-Pose`.
7. **`Rig_Medium_Simulation.glb` (13 động tác + `T-Pose`):**
   `Lie_Down`, `Lie_Idle`, `Lie_Pose`, `Lie_StandUp`, `Sit_Chair_Down`, `Sit_Chair_Idle`, `Sit_Chair_Pose`, `Sit_Chair_StandUp`, `Sit_Floor_Down`, `Sit_Floor_Idle`, `Sit_Floor_Pose`, `Sit_Floor_StandUp`, `Waving`, `T-Pose`.
8. **`Rig_Medium_Tools.glb` (28 động tác + `T-Pose`):**
   `Chopping`, `Digging`, `Fishing_Cast`, `Fishing_Catch`, `Fishing_Idle`, `Fishing_Reeling`, `Fishing_Struggle`, `Fishing_Tug`, `Hammering`, `Holding_A`, `Holding_B`, `Holding_C`, `Lockpicking`, `Mining`, `Pickaxing`, `Sawing`, `Shoveling`, `Working_A`, `Working_B`, `Working_C`, `T-Pose`.

### C. Danh sách tên clip của Thú Đồng Hành (`Quaternius CC0`)
- **`Wolf.glb` (Thú 1 — Sói Chiến Cận Chiến) & `Fox.glb` (Thú 2 — Hồ Ly Linh Hồn Đánh Xa):**
  `AnimalArmature|Idle`, `AnimalArmature|Idle_2`, `AnimalArmature|Idle_2_HeadLow`, `AnimalArmature|Walk`, `AnimalArmature|Gallop`, `AnimalArmature|Gallop_Jump`, `AnimalArmature|Attack`, `AnimalArmature|Eating`, `AnimalArmature|Idle_HitReact_Left`, `AnimalArmature|Idle_HitReact_Right`, `AnimalArmature|Jump_ToIdle`, `AnimalArmature|Death`.
- **`Wasp.glb` (Thú 2 tùy chọn đổi trực tiếp trong HUD — Ong Tinh Linh Bay):**
  `WaspArmature|Wasp_Flying`, `WaspArmature|Wasp_Attack`, `WaspArmature|Wasp_Death`.

---

## 3. Cách Chạy Lại Bản Thử 3D Chỉ Với 1 Bước

- **Cách 1 (Click đúp file `.bat`):**
  Mở `D:\game\kaykit-combat-preview\start-preview.bat`
- **Cách 2 (Dòng lệnh):**
  ```powershell
  cd D:\game\kaykit-combat-preview
  npm run dev
  ```
- Mở trình duyệt tại: **`http://localhost:5174/`**
