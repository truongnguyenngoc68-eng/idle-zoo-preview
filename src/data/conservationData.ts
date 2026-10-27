export type SpeciesId = 'red_deer' | 'gray_wolf' | 'red_fox';
export type KnowledgeOnlySpeciesId = 'saola' | 'dhole' | 'sunda_pangolin';
export type AllSpeciesId = SpeciesId | KnowledgeOnlySpeciesId;

export type HabitatZoneId = 'meadow_glade' | 'pine_highland' | 'woodland_stream';

export interface SpeciesScienceData {
  id: AllSpeciesId;
  presentInPark: boolean;
  vietnameseName: string;
  scientificName: string;
  iucnStatusCode: 'LC' | 'NT' | 'VU' | 'EN' | 'CR';
  iucnStatusLabel: string;
  sourceUrl: string;
  sourceTitle: string;
  lookupDate: string;
  usageTermsNote: string;
  naturalHabitat: string;
  naturalDiet: string;
  naturalBehavior: string;
  mainThreats: string;
  humanActions: string;
  modelNote: string;
  preferredZone?: HabitatZoneId;
  modelFiles?: {
    juvenile: string;
    adult: string;
  };
  simulationTargets?: {
    minTrees: number;
    minWater: number;
    minShelter: number;
    minEnrichment: number;
    minQuietness: number;
  };
  releaseHabitats?: {
    id: string;
    name: string;
    suitable: boolean;
    reason: string;
  }[];
}

export type PlaceableCategory =
  | 'enclosure_template'
  | 'tree'
  | 'pond'
  | 'rock'
  | 'shelter'
  | 'enrichment'
  | 'feeder'
  | 'path'
  | 'viewing_sign'
  | 'bench'
  | 'service_kiosk';

export interface PlaceableCatalogItem {
  id: string;
  name: string;
  category: PlaceableCategory;
  cost: number;
  refund: number;
  modelPath: string;
  scale: number;
  footprintW: number;
  footprintD: number;
  description: string;
  zoneAffinity?: HabitatZoneId;
  welfareBonus?: {
    trees?: number;
    water?: number;
    shelter?: number;
    enrichment?: number;
    quietness?: number;
    visitorComfort?: number;
    educationBoost?: number;
  };
}

export interface PlacedItem {
  uid: string;
  catalogId: string;
  gx: number;
  gz: number;
  rotationY: number;
}

export type GrowthStage = 'juvenile_rescue' | 'rehab_subadult' | 'adult_ready';

export type AnimalBehaviorState = 'Idle' | 'Walking' | 'Running' | 'Eating' | 'Resting';

export interface RescuedAnimal {
  id: string;
  code: string;
  name: string;
  speciesId: SpeciesId;
  zoneId: HabitatZoneId;
  stage: GrowthStage;
  hunger: number;        // 0..100 (100 = no bụng)
  health: number;        // 0..100
  comfort: number;       // 0..100
  rehabProgress: number; // 0..100
  wildReadiness: number; // 0..100 (khả năng tự lập ngoài tự nhiên)
  permanentCareRequired: boolean;
  permanentCareReason?: string;
  rescueOriginStory: string;
  rescuedAtSimTime: number;
  currentBehavior: AnimalBehaviorState;
  lastFedTimestamp: number;
  lastVetCheckTimestamp: number;
}

export interface RescueCaseCandidate {
  caseId: string;
  code: string;
  defaultName: string;
  speciesId: SpeciesId;
  zoneId: HabitatZoneId;
  initialStage: GrowthStage;
  initialHealth: number;
  initialHunger: number;
  permanentCareRequired: boolean;
  permanentCareReason?: string;
  story: string;
  intakeGrantMoney: number;
}

export interface ReleasedAnimalRecord {
  id: string;
  code: string;
  name: string;
  speciesId: SpeciesId;
  releasedAtIso: string;
  releaseHabitatName: string;
  finalHealth: number;
  finalComfort: number;
  reputationAwarded: number;
  followUpUpdates: {
    id: string;
    timestampIso: string;
    title: string;
    message: string;
    collarSignalStrength: string;
  }[];
  nextFollowUpAtMs?: number;
  followUpStage: number; // 0 -> 1 -> 2 completed
}

export interface ParkSaveProfile {
  saveVersion: number;
  profileId: string;
  parkName: string;
  createdAtIso: string;
  lastSavedAtMs: number;
  lastActiveAtMs: number;
  lastAfkClaimedAtMs: number;
  simSecondsElapsed: number;
  money: number;
  conservationReputation: number;
  ticketPrice: number;
  staffAutoCareEnabled: boolean;
  builtZones: Record<HabitatZoneId, boolean>;
  placedItems: PlacedItem[];
  animals: RescuedAnimal[];
  pendingRescueCases: RescueCaseCandidate[];
  releasedRecords: ReleasedAnimalRecord[];
  unlockedSpeciesKnowledge: AllSpeciesId[];
  completedMilestones: string[];
  stats: {
    totalVisitorsServed: number;
    totalVisitorsEducated: number;
    totalTicketRevenue: number;
    totalServiceRevenue: number;
    totalCareExpenses: number;
    visitorSatisfaction: number;
  };
}

export const SPECIES_DATABASE: Record<AllSpeciesId, SpeciesScienceData> = {
  red_deer: {
    id: 'red_deer',
    presentInPark: true,
    vietnameseName: 'Hươu Đỏ',
    scientificName: 'Cervus elaphus',
    iucnStatusCode: 'LC',
    iucnStatusLabel: 'Ít lo ngại (Least Concern — LC)',
    sourceUrl: 'https://www.iucnredlist.org/species/55997072/142404453',
    sourceTitle: 'IUCN Red List — Cervus elaphus (Lovari, S. et al.)',
    lookupDate: '2026-10-25',
    usageTermsNote: 'Dữ liệu phân loại học & sinh thái học tóm tắt phục vụ giáo dục phi lợi nhuận theo nguyên tắc trích dẫn nguồn mở IUCN Red List.',
    naturalHabitat: 'Rừng hỗn giao ôn đới, bìa rừng thưa, đồng cỏ ven suối và thung lũng núi cao châu Âu, Tây Á & Trung Á.',
    naturalDiet: 'Động vật ăn cỏ nhai lại: cỏ tươi, chồi non, lá cây bụi, quả rụng và vỏ cây vào mùa đông.',
    naturalBehavior: 'Sống theo đàn mẫu hệ, kiếm ăn mạnh vào lúc bình minh và hoàng hôn; con đực trưởng thành mọc gạc phân nhánh và rụng gạc hằng năm.',
    mainThreats: 'Dù mức toàn cầu là Ít lo ngại (LC), nhiều quần thể địa phương bị chia cắt sinh cảnh do đường cao tốc, săn bắn lấy gạc trái phép và lai tạp di truyền.',
    humanActions: 'Xây cầu vượt sinh thái qua đường giao thông, duy trì hành lang rừng tự nhiên, không tiêu thụ sản phẩm săn bắt trái phép và giữ khoảng cách yên tĩnh khi du lịch sinh thái.',
    modelNote: 'Sử dụng model 3D Quaternius: Stag.glb (cá thể trưởng thành có gạc) và Deer.glb (cá thể non/cái). Thiếu clip ngủ nằm riêng nên dùng Idle_Headlow khi nghỉ tại chỗ trú.',
    preferredZone: 'meadow_glade',
    modelFiles: {
      juvenile: '/assets/animals/Deer.glb',
      adult: '/assets/animals/Stag.glb',
    },
    simulationTargets: {
      minTrees: 3,
      minWater: 1,
      minShelter: 1,
      minEnrichment: 1,
      minQuietness: 65,
    },
    releaseHabitats: [
      {
        id: 'meadow_corridor',
        name: 'Khu Bảo tồn Thung lũng Rừng Thưa & Đồng cỏ Ôn đới',
        suitable: true,
        reason: 'Có đồng cỏ xen rừng thưa, nguồn nước suối tự nhiên và hành lang sinh thái an toàn cho hươu ăn cỏ.',
      },
      {
        id: 'arid_rock_crag',
        name: 'Vách Đá Khô Hạn Không Có Thảm Cỏ',
        suitable: false,
        reason: 'Không phù hợp: thiếu nguồn cỏ tươi, chồi lá và bóng râm che chắn cho loài ăn cỏ nhai lại.',
      },
      {
        id: 'urban_fringe_park',
        name: 'Rừng Ven Đô Gần Đường Cao Tốc Không Rào Chắn',
        suitable: false,
        reason: 'Nguy cơ tai nạn giao thông rất cao và tiếng ồn đô thị gây căng thẳng mãn tính.',
      },
    ],
  },
  gray_wolf: {
    id: 'gray_wolf',
    presentInPark: true,
    vietnameseName: 'Sói Xám',
    scientificName: 'Canis lupus',
    iucnStatusCode: 'LC',
    iucnStatusLabel: 'Ít lo ngại (Least Concern — LC)',
    sourceUrl: 'https://www.iucnredlist.org/species/3746/163428857',
    sourceTitle: 'IUCN Red List — Canis lupus (Boitani, L., Phillips, M. & Jhala, Y.)',
    lookupDate: '2026-10-25',
    usageTermsNote: 'Dữ liệu tóm tắt từ hồ sơ đánh giá toàn cầu IUCN Red List (tra cứu 2026-10-25); không gán nhãn nguy cấp giả tạo cho loài LC.',
    naturalHabitat: 'Rừng thông phương bắc (taiga), rừng ôn đới, thảo nguyên và vùng núi đá rộng lớn tại Bắc Bán Cầu.',
    naturalDiet: 'Động vật ăn thịt đầu bảng: săn các loài móng guốc cỡ trung bình – lớn, thú nhỏ và đóng vai trò kiểm soát quần thể con mồi.',
    naturalBehavior: 'Sống theo cấu trúc gia đình gắn kết cao, giao tiếp bằng hú, ngôn ngữ cơ thể và đánh dấu lãnh thổ; di chuyển quãng đường dài mỗi ngày.',
    mainThreats: 'Xung đột với hoạt động chăn nuôi gia súc, bẫy thú, săn bắn trả đũa và thu hẹp vùng lãnh thổ hoang dã liền mạch.',
    humanActions: 'Áp dụng biện pháp bảo vệ gia súc không gây sát thương (hàng rào điện sinh thái, chó chăn cừu), bảo tồn vùng lõi rừng lớn để duy trì cân bằng lưới thức ăn.',
    modelNote: 'Sử dụng model 3D Quaternius: Wolf.glb (51 khớp xương, 12 clip animation). Tăng trưởng mô phỏng bằng tỉ lệ scale; nghỉ ngơi dùng clip Idle_2_HeadLow.',
    preferredZone: 'pine_highland',
    modelFiles: {
      juvenile: '/assets/animals/Wolf.glb',
      adult: '/assets/animals/Wolf.glb',
    },
    simulationTargets: {
      minTrees: 3,
      minWater: 1,
      minShelter: 1,
      minEnrichment: 2,
      minQuietness: 70,
    },
    releaseHabitats: [
      {
        id: 'northern_pine_reserve',
        name: 'Vùng Lõi Rừng Thông Núi Đá Bắc Bán Cầu (Cách xa khu chăn nuôi)',
        suitable: true,
        reason: 'Lãnh thổ rừng thông và đá núi rộng lớn, giàu con mồi tự nhiên và tách biệt khỏi trang trại gia súc.',
      },
      {
        id: 'livestock_farmland',
        name: 'Đồng Cỏ Chăn Thả Gia Súc Gần Khu Dân Cư',
        suitable: false,
        reason: 'Không phù hợp: dễ phát sinh xung đột trực tiếp với người chăn nuôi và nguy cơ bị đánh bẫy.',
      },
      {
        id: 'small_isolated_patch',
        name: 'Mảnh Rừng Nhỏ Bị Cô Lập (< 5 km²)',
        suitable: false,
        reason: 'Diện tích quá hẹp so với tập tính di chuyển và lãnh thổ tự nhiên của Sói Xám.',
      },
    ],
  },
  red_fox: {
    id: 'red_fox',
    presentInPark: true,
    vietnameseName: 'Cáo Đỏ',
    scientificName: 'Vulpes vulpes',
    iucnStatusCode: 'LC',
    iucnStatusLabel: 'Ít lo ngại (Least Concern — LC)',
    sourceUrl: 'https://www.iucnredlist.org/species/23062/222036411',
    sourceTitle: 'IUCN Red List — Vulpes vulpes (Hoffmann, M. & Sillero-Zubiri, C.)',
    lookupDate: '2026-10-25',
    usageTermsNote: 'Dữ liệu khoa học tra cứu từ IUCN Red List (2026-10-25). Phân biệt rõ thực tế sinh học và thông số phúc lợi mô phỏng.',
    naturalHabitat: 'Rừng lá rộng, bụi rậm ven suối, đồng cỏ và vùng chuyển tiếp nông – lâm nghiệp.',
    naturalDiet: 'Động vật ăn tạp thiên về thịt nhỏ: gặm nhấm, côn trùng, chim mặt đất, quả mọng rừng và củ rễ.',
    naturalBehavior: 'Hoạt động linh hoạt lúc chạng vạng và ban đêm; thính giác cực nhạy giúp định vị con mồi dưới lớp cỏ dày hoặc tuyết; đào hang trú ẩn dưới gốc cây/hốc đá.',
    mainThreats: 'Mắc bẫy dây, ngộ độc thứ cấp do thuốc diệt chuột hóa học trong nông nghiệp, tai nạn giao thông và dịch bệnh lây từ vật nuôi thả rông.',
    humanActions: 'Không dùng bả độc diệt chuột gây hại chuỗi thức ăn, tiêm phòng đầy đủ cho vật nuôi, tháo gỡ bẫy kẹp tự chế và giữ bụi cây ven suối làm nơi trú ẩn.',
    modelNote: 'Sử dụng model 3D Quaternius: Fox.glb (51 khớp xương, 12 clip animation). Tăng trưởng mô phỏng bằng tỉ lệ scale; nghỉ ngơi dùng clip Idle_2_HeadLow.',
    preferredZone: 'woodland_stream',
    modelFiles: {
      juvenile: '/assets/animals/Fox.glb',
      adult: '/assets/animals/Fox.glb',
    },
    simulationTargets: {
      minTrees: 2,
      minWater: 1,
      minShelter: 1,
      minEnrichment: 2,
      minQuietness: 60,
    },
    releaseHabitats: [
      {
        id: 'riparian_woodland',
        name: 'Hành Lang Rừng Bụi Ven Suối Không Thuốc Trừ Sâu Độc Hại',
        suitable: true,
        reason: 'Có nhiều bụi cây quả mọng, khúc gỗ rỗng trú ẩn, nguồn nước sạch và an toàn khỏi bả độc.',
      },
      {
        id: 'intensive_pesticide_farm',
        name: 'Khu Canh Tác Dùng Nhiều Thuốc Diệt Chuột Hóa Học',
        suitable: false,
        reason: 'Nguy cơ ngộ độc thứ cấp rất cao khi cáo săn loài gặm nhấm nhiễm độc.',
      },
      {
        id: 'highway_median',
        name: 'Dải Cây Xanh Giữa Đại Lộ Đông Xe',
        suitable: false,
        reason: 'Không đủ an toàn, nguy cơ va chạm phương tiện giao thông vào ban đêm.',
      },
    ],
  },

  // === CHUYÊN MỤC TÌM HIỂU LOÀI CẦN BẢO VỆ (CHƯA CÓ MODEL 3D TRONG KHU NUÔI) ===
  saola: {
    id: 'saola',
    presentInPark: false,
    vietnameseName: 'Sao La (Kỳ Lân Châu Á)',
    scientificName: 'Pseudoryx nghetinhensis',
    iucnStatusCode: 'CR',
    iucnStatusLabel: 'Cực kỳ nguy cấp (Critically Endangered — CR)',
    sourceUrl: 'https://www.iucnredlist.org/species/18597/166485696',
    sourceTitle: 'IUCN Red List — Pseudoryx nghetinhensis (Timmins, R.J. et al.) & Saola Working Group',
    lookupDate: '2026-10-25',
    usageTermsNote: 'Thẻ kiến thức giáo dục bảo tồn. Tuyệt đối không dùng model Hươu/Bò Quaternius để giả làm Sao La trong khu nuôi.',
    naturalHabitat: 'Rừng nguyên sinh thường xanh ẩm ướt vùng núi dãy Trường Sơn (Việt Nam – Lào), gần các khe suối đá mát.',
    naturalDiet: 'Lá cây bụi ưa ẩm dọc khe suối rừng sâu (như cây thiên niên kiện, dương xỉ và cây thân thảo ven suối).',
    naturalBehavior: 'Sống kín đáo, đơn độc hoặc theo cặp nhỏ; cặp sừng dài thẳng song song đặc trưng ở cả đực và cái. Mới được khoa học phát hiện năm 1992 tại Vũ Quang (Hà Tĩnh).',
    mainThreats: 'Bẫy dây tự chế đặt tràn lan trong rừng (dù nhắm vào loài khác nhưng vô tình sát hại Sao La) và sự phân mảnh rừng Trường Sơn.',
    humanActions: 'Hỗ trợ các đội tuần tra tháo gỡ bẫy dây tại dãy Trường Sơn, tuyệt đối không tiêu thụ thịt thú rừng và ủng hộ các chương trình bảo tồn tại chỗ.',
    modelNote: '⚠️ CHƯA HIỆN DIỆN TRONG KHU NUÔI 3D: Bộ model miễn phí Quaternius không có model Sao La. Để đảm bảo tính chính xác khoa học, game không dùng model Hươu hay Bò để minh họa sai loài.',
  },
  dhole: {
    id: 'dhole',
    presentInPark: false,
    vietnameseName: 'Sói Đỏ (Chó Rừng Đông Dương)',
    scientificName: 'Cuon alpinus',
    iucnStatusCode: 'EN',
    iucnStatusLabel: 'Nguy cấp (Endangered — EN)',
    sourceUrl: 'https://www.iucnredlist.org/species/5953/163599751',
    sourceTitle: 'IUCN Red List — Cuon alpinus (Kamler, J.F. et al.)',
    lookupDate: '2026-10-25',
    usageTermsNote: 'Thẻ kiến thức giáo dục bảo tồn. Không lấy biến thể màu hoặc model Cáo/Sói Xám để gọi nhầm thành Sói Đỏ.',
    naturalHabitat: 'Rừng nhiệt đới khô, rừng thường xanh và trảng cỏ rừng tại Nam Á và Đông Nam Á (trong đó có Việt Nam).',
    naturalDiet: 'Thú móng guốc cỡ trung bình trong rừng; săn mồi phối hợp theo bầy có tính xã hội rất cao.',
    naturalBehavior: 'Giao tiếp bằng tiếng huýt sáo đặc trưng, sống theo bầy hợp tác chăm sóc con non và chia sẻ thức ăn.',
    mainThreats: 'Suy giảm nghiêm trọng nguồn con mồi tự nhiên do săn bắt, mất rừng sinh cảnh và lây nhiễm bệnh dại/care từ chó nhà.',
    humanActions: 'Bảo vệ quần thể thú móng guốc tự nhiên trong vườn quốc gia, tiêm phòng dịch bệnh cho chó nhà ở vùng đệm rừng.',
    modelNote: '⚠️ CHƯA HIỆN DIỆN TRONG KHU NUÔI 3D: Khác biệt hình thái rõ rệt với Sói Xám (Canis lupus) và Cáo Đỏ (Vulpes vulpes); hiện chỉ mở khóa dưới dạng Thẻ Kiến Thức Bảo Tồn.',
  },
  sunda_pangolin: {
    id: 'sunda_pangolin',
    presentInPark: false,
    vietnameseName: 'Tê Tê Java',
    scientificName: 'Manis javanica',
    iucnStatusCode: 'CR',
    iucnStatusLabel: 'Cực kỳ nguy cấp (Critically Endangered — CR)',
    sourceUrl: 'https://www.iucnredlist.org/species/12763/123584856',
    sourceTitle: 'IUCN Red List — Manis javanica (Challender, D. et al.) & Save Vietnam’s Wildlife',
    lookupDate: '2026-10-25',
    usageTermsNote: 'Thẻ kiến thức giáo dục bảo tồn chính thống từ IUCN Red List.',
    naturalHabitat: 'Rừng nguyên sinh, rừng thứ sinh và vùng cây bụi Đông Nam Á.',
    naturalDiet: 'Kiến và mối (sử dụng lưỡi dài dính và móng vuốt khỏe để đào tổ mối, giúp kiểm soát côn trùng rừng).',
    naturalBehavior: 'Hoạt động ban đêm, leo trèo giỏi, cuộn tròn thành quả cầu vảy keratin cứng khi gặp nguy hiểm.',
    mainThreats: 'Săn bắt và buôn bán trái phép lấy thịt và vảy (vốn chỉ có cấu tạo keratin giống móng tay người, không có thần dược như lời đồn).',
    humanActions: 'Lên án và báo cơ quan chức năng khi phát hiện buôn bán tê tê; lan tỏa kiến thức khoa học rằng vảy tê tê chỉ là keratin như móng tay người.',
    modelNote: '⚠️ CHƯA HIỆN DIỆN TRONG KHU NUÔI 3D: Chưa có model 3D Tê Tê trong bộ Quaternius CC0. Hiển thị trong Sổ Loài để nâng cao nhận thức bảo vệ động vật hoang dã tại Việt Nam.',
  },
};

export interface HabitatZoneTemplate {
  id: HabitatZoneId;
  name: string;
  environmentLabel: string;
  speciesId: SpeciesId;
  unlockCost: number;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  groundColor: number;
  viewingPoint: { x: number; z: number };
  keeperGatePoint: { x: number; z: number };
  description: string;
}

export const HABITAT_ZONES: Record<HabitatZoneId, HabitatZoneTemplate> = {
  meadow_glade: {
    id: 'meadow_glade',
    name: 'Khu Cứu Hộ 1: Đồng Cỏ & Rừng Thưa',
    environmentLabel: 'Đồng cỏ ôn đới xen cây lá rộng',
    speciesId: 'red_deer',
    unlockCost: 120,
    centerX: -7,
    centerZ: -2,
    width: 8,
    depth: 8,
    groundColor: 0x7cb342,
    viewingPoint: { x: -2, z: -2 },
    keeperGatePoint: { x: -2, z: -4 },
    description: 'Khu sinh cảnh đồng cỏ rộng thoáng có hàng rào gỗ bảo vệ, điểm ngắm an toàn và cổng tiếp cận cho nhân viên chăm sóc Hươu Đỏ.',
  },
  pine_highland: {
    id: 'pine_highland',
    name: 'Khu Cứu Hộ 2: Rừng Thông Đá Cao Nguyên',
    environmentLabel: 'Rừng thông & gờ đá mát',
    speciesId: 'gray_wolf',
    unlockCost: 220,
    centerX: 7,
    centerZ: -2,
    width: 8,
    depth: 8,
    groundColor: 0x558b2f,
    viewingPoint: { x: 2, z: -2 },
    keeperGatePoint: { x: 2, z: -4 },
    description: 'Sinh cảnh rừng thông yên tĩnh với khoảng cách quan sát an toàn, phù hợp phục hồi tập tính cho Sói Xám.',
  },
  woodland_stream: {
    id: 'woodland_stream',
    name: 'Khu Cứu Hộ 3: Bụi Rậm Ven Suối',
    environmentLabel: 'Rừng cây bụi & suối nhỏ',
    speciesId: 'red_fox',
    unlockCost: 180,
    centerX: -7,
    centerZ: 8,
    width: 8,
    depth: 6,
    groundColor: 0x689f38,
    viewingPoint: { x: -2, z: 8 },
    keeperGatePoint: { x: -2, z: 6 },
    description: 'Khu rừng bụi có nhiều chỗ ẩn nấp, khúc gỗ rỗng và bụi quả mọng dành cho Cáo Đỏ phục hồi.',
  },
};

export const PLACEABLE_CATALOG: PlaceableCatalogItem[] = [
  {
    id: 'tree_common',
    name: 'Cây Lá Rộng (Tán Mát)',
    category: 'tree',
    cost: 25,
    refund: 18,
    modelPath: '/assets/nature/CommonTree_1.glb',
    scale: 0.85,
    footprintW: 1,
    footprintD: 1,
    description: 'Tăng bóng mát, độ che phủ cây xanh (+1 Cây xanh, +6 Yên tĩnh).',
    welfareBonus: { trees: 1, quietness: 6 },
  },
  {
    id: 'tree_pine',
    name: 'Cây Thông Cao Nguyên',
    category: 'tree',
    cost: 30,
    refund: 22,
    modelPath: '/assets/nature/PineTree_1.glb',
    scale: 0.9,
    footprintW: 1,
    footprintD: 1,
    description: 'Cây thông tạo sinh cảnh rừng kín đáo (+1 Cây xanh, +8 Yên tĩnh).',
    welfareBonus: { trees: 1, quietness: 8 },
  },
  {
    id: 'bush_berries',
    name: 'Bụi Quả Mọng & Lá Xanh',
    category: 'enrichment',
    cost: 20,
    refund: 15,
    modelPath: '/assets/nature/BushBerries_1.glb',
    scale: 1.1,
    footprintW: 1,
    footprintD: 1,
    description: 'Làm giàu môi trường kiếm ăn tự nhiên và chỗ ẩn nấp nhỏ (+1 Làm giàu, +1 Cây xanh).',
    welfareBonus: { enrichment: 1, trees: 1, quietness: 4 },
  },
  {
    id: 'pond_natural',
    name: 'Hồ Nước Tự Nhiên & Hoa Súng',
    category: 'pond',
    cost: 45,
    refund: 32,
    modelPath: '/assets/nature/Lilypad.glb',
    scale: 1.0,
    footprintW: 2,
    footprintD: 2,
    description: 'Cung cấp nguồn nước uống và làm mát sinh cảnh (+1 Nguồn nước). Khách & thú không đi xuyên mặt hồ.',
    welfareBonus: { water: 1, quietness: 5 },
  },
  {
    id: 'shelter_stable',
    name: 'Chỗ Trú Ẩn Gỗ Kín Gió',
    category: 'shelter',
    cost: 60,
    refund: 45,
    modelPath: '/assets/village/Stable.glb',
    scale: 0.55,
    footprintW: 2,
    footprintD: 2,
    description: 'Nơi trú mưa nắng và nghỉ ngơi kín đáo giúp giảm căng thẳng (+1 Chỗ trú, +10 Yên tĩnh).',
    welfareBonus: { shelter: 1, quietness: 10 },
  },
  {
    id: 'enrichment_log_rock',
    name: 'Khúc Gỗ Rêu & Đá Tự Nhiên',
    category: 'enrichment',
    cost: 25,
    refund: 18,
    modelPath: '/assets/nature/WoodLog_Moss.glb',
    scale: 1.15,
    footprintW: 1,
    footprintD: 1,
    description: 'Đồ làm giàu môi trường giúp thú rèn luyện bản năng tự nhiên (+1 Làm giàu).',
    welfareBonus: { enrichment: 1, quietness: 3 },
  },
  {
    id: 'rock_boulder',
    name: 'Cụm Đá Rêu Chắn Ồn',
    category: 'rock',
    cost: 20,
    refund: 14,
    modelPath: '/assets/nature/Rock_Moss_1.glb',
    scale: 1.1,
    footprintW: 1,
    footprintD: 1,
    description: 'Tạo địa hình tự nhiên và chắn tầm nhìn/tiếng ồn (+1 Làm giàu, +8 Yên tĩnh).',
    welfareBonus: { enrichment: 1, quietness: 8 },
  },
  {
    id: 'feeder_hay',
    name: 'Điểm Cho Ăn Sinh Thái',
    category: 'feeder',
    cost: 30,
    refund: 20,
    modelPath: '/assets/village/Hay.glb',
    scale: 1.0,
    footprintW: 1,
    footprintD: 1,
    description: 'Máng thức ăn đặt trong khu nuôi để nhân viên tiếp tế và thú tới ăn.',
    welfareBonus: { enrichment: 1 },
  },
  {
    id: 'path_stone',
    name: 'Đường Đi Lát Đá (1x1)',
    category: 'path',
    cost: 10,
    refund: 8,
    modelPath: '/assets/village/Path_Square.glb',
    scale: 1.0,
    footprintW: 1,
    footprintD: 1,
    description: 'Nối cổng bán vé tới các điểm ngắm thú và trạm cứu hộ.',
    welfareBonus: { visitorComfort: 2 },
  },
  {
    id: 'edu_signboard',
    name: 'Biển Giáo Dục Bảo Tồn',
    category: 'viewing_sign',
    cost: 35,
    refund: 25,
    modelPath: '/assets/village/Well.glb',
    scale: 0.5,
    footprintW: 1,
    footprintD: 1,
    description: 'Đặt cạnh điểm ngắm thú để khách đọc thông tin IUCN, tăng nhận thức và Uy tín bảo tồn.',
    welfareBonus: { educationBoost: 15, visitorComfort: 5 },
  },
  {
    id: 'bench_rest',
    name: 'Ghế Nghỉ Cho Khách',
    category: 'bench',
    cost: 18,
    refund: 12,
    modelPath: '/assets/village/Bench_1.glb',
    scale: 0.9,
    footprintW: 1,
    footprintD: 1,
    description: 'Giúp khách tham quan nghỉ chân dọc đường đi (+6 Hài lòng khách).',
    welfareBonus: { visitorComfort: 6 },
  },
  {
    id: 'service_kiosk',
    name: 'Quầy Gây Quỹ & Nước Uống Xanh',
    category: 'service_kiosk',
    cost: 75,
    refund: 55,
    modelPath: '/assets/village/MarketStand_1.glb',
    scale: 0.75,
    footprintW: 2,
    footprintD: 1,
    description: 'Khu dịch vụ nhỏ cung cấp nước uống thân thiện môi trường, đóng góp thêm kinh phí duy trì cứu hộ.',
    welfareBonus: { visitorComfort: 10 },
  },
];

export const INITIAL_RESCUE_CASES: RescueCaseCandidate[] = [
  {
    caseId: 'case_deer_01',
    code: 'RD-2026-01',
    defaultName: 'Lộc Non',
    speciesId: 'red_deer',
    zoneId: 'meadow_glade',
    initialStage: 'juvenile_rescue',
    initialHealth: 58,
    initialHunger: 52,
    permanentCareRequired: false,
    story: 'Phát hiện bị lạc đàn và xây xát nhẹ bên hàng rào đường cao tốc ven rừng. Cần khu đồng cỏ yên tĩnh, thức ăn, nước sạch và phục hồi thể lực để tái thả về thung lũng tự nhiên.',
    intakeGrantMoney: 60,
  },
  {
    caseId: 'case_wolf_02',
    code: 'GW-2026-02',
    defaultName: 'Bắc Phong',
    speciesId: 'gray_wolf',
    zoneId: 'pine_highland',
    initialStage: 'rehab_subadult',
    initialHealth: 54,
    initialHunger: 48,
    permanentCareRequired: false,
    story: 'Giải cứu khỏi bẫy dây tự chế ở bìa rừng thông. Chân trước đã được thú y xử lý, cần khu rừng thông đá yên tĩnh và đồ làm giàu môi trường để phục hồi khả năng vận động tự nhiên.',
    intakeGrantMoney: 90,
  },
  {
    caseId: 'case_fox_03',
    code: 'RF-2026-03',
    defaultName: 'Mật Đào',
    speciesId: 'red_fox',
    zoneId: 'woodland_stream',
    initialStage: 'juvenile_rescue',
    initialHealth: 62,
    initialHunger: 45,
    permanentCareRequired: false,
    story: 'Cá thể cáo non suy nhược do mất nơi trú ẩn ven suối. Phản xạ tự nhiên tốt, có thể phục hồi và tái thả khi đạt đủ sức khỏe và kỹ năng tìm mồi.',
    intakeGrantMoney: 70,
  },
  {
    caseId: 'case_deer_perm_04',
    code: 'RD-2026-04',
    defaultName: 'An Nhiên (Chăm sóc lâu dài)',
    speciesId: 'red_deer',
    zoneId: 'meadow_glade',
    initialStage: 'adult_ready',
    initialHealth: 76,
    initialHunger: 65,
    permanentCareRequired: true,
    permanentCareReason: 'Tổn thương thị lực vĩnh viễn ở mắt phải do chấn thương cũ trước khi cứu hộ; hội đồng thú y đánh giá không đủ an toàn để tự tránh thiên địch ngoài tự nhiên. Cần chăm sóc nhân đạo lâu dài tại vườn.',
    story: 'Cá thể Hươu Đỏ trưởng thành đã hồi phục vết thương nhưng giảm thị lực vĩnh viễn, không đủ điều kiện tái thả. Lưu lại vườn làm đại sứ giáo dục bảo tồn.',
    intakeGrantMoney: 80,
  },
];
