// 纯逻辑核心：常量、类型、数值配置
// 零 cc 依赖 —— node 可直接 `node xxx.ts` 运行，Cocos 渲染层也 import 同一份
// 坐标系沿用 Cocos UI：原点屏幕中心，X∈[-375,375] Y∈[-667,667]

// ---- 几何 / 边界 ----
export const LANE_LEFT_X = -190;   // 左路（道具）中心
export const LANE_RIGHT_X = 190;   // 右路（怪物）中心
export const SCREEN_TOP = 667;
export const PLAYER_Y = -470;   // 主角小队 y(小队占屏幕下方~1/3,与怪海分庭抗礼)
export const PLAYER_MIN_X = LANE_LEFT_X;
export const PLAYER_MAX_X = LANE_RIGHT_X;
export const BASELINE_Y = -400;    // 怪到此 Y 触发扣血(贴到主角小队头顶才扣血=短兵相接,怪怼脸上)
export const BULLET_SPEED = 1200;
export const SHOOT_INTERVAL = 0.12; // 固定射速（秒/发）

// 右路出怪 X 抖动半径。怪必须落在玩家可达范围内（玩家 X 上限 = PLAYER_MAX_X = 190）
// 否则会出现"怪在 x>190、玩家够不到、永远打不死"的 bug。
// 取 ±55，使怪散布在 [135,190]，玩家在右路边缘或微调走位即可全覆盖
export const ENEMY_SPAWN_JITTER = 55;

// ---- 武器 ----
export const WeaponLevel = {
    PISTOL: 0, SMG: 1, RIFLE: 2, MACHINE_GUN: 3, HEAVY_MG: 4, LASER: 5,
} as const;
export type WeaponLevel = typeof WeaponLevel[keyof typeof WeaponLevel];
export const NAMED_WEAPON_MAX = WeaponLevel.LASER;   // 最高有专属外观的武器档(激光=5),之上纯涨伤害

export const WEAPON_NAMES = ['手枪', '冲锋枪', '步枪', '机枪', '重机枪', '激光'];
export interface WeaponStat { damage: number; bulletWidth: number; color: string; }
// 前6档专属外观（伤害 2^level）。武器无上限升级：超过激光(5)后纯涨伤害(2^level)、外观沿用激光。
// 数值全链 ×100：血量/伤害放大 100 倍，给整数表达留"分辨率"，
// 避免 base.hp 太小时 ÷HORDE_DENSITY 后被 round/地板(max(1))扭曲、破坏总威胁守恒。
// 全部等比放大 → 难度数学等价，仅精度提升。
export const WEAPON_STATS: WeaponStat[] = [
    { damage: 100,  bulletWidth: 4,  color: '#FFFFFF' },   // 手枪 白
    { damage: 200,  bulletWidth: 6,  color: '#F9E784' },   // 冲锋枪 黄
    { damage: 400,  bulletWidth: 8,  color: '#F5A623' },   // 步枪 橙
    { damage: 800,  bulletWidth: 12, color: '#E5484D' },   // 机枪 红
    { damage: 1600, bulletWidth: 16, color: '#9B59E0' },   // 重机枪 紫
    { damage: 3200, bulletWidth: 20, color: '#3FE0D0' },   // 激光 青
];
// 武器伤害（无上限）= 2^level × 100。超过专属档(5)继续翻倍。
export function weaponDamage(level: number): number { return Math.pow(2, level) * 100; }
// 武器外观（颜色/弹宽）：超过专属档取最高档(激光)外观。
export function weaponStat(level: number): WeaponStat {
    return WEAPON_STATS[Math.min(level, NAMED_WEAPON_MAX)];
}
// 武器名：≤5 用专属名；>5 显示"激光+N"(N=超出档数)。
export function weaponName(level: number): string {
    return level <= NAMED_WEAPON_MAX ? WEAPON_NAMES[level] : `${WEAPON_NAMES[NAMED_WEAPON_MAX]}+${level - NAMED_WEAPON_MAX}`;
}

// ---- 人数 ----
// 加人翻倍无上限：1→2→4→8→16→32→64…（每次 ×2，与武器升级对称）。人数纯属战力(DPS)+视觉,无封顶。
export const PERSON_BASE_RADIUS = 14;   // 单个小人基础半径(占位用,渲染按 scale 缩放)

// 动态布局：Count Masters 式「人堆」——横向铺满泳道宽 + 奇偶排六边形错位 + 确定性抖动。
// (调研结论：竖屏/底部/横向铺满/人挨人 场景,行填充优于圆形螺旋。)返回每个的 [dx, dy, scale]。
//  - 横向先铺满一排(列数=泳道宽/间距),再往后(dy 负方向=屏幕上方)堆排 → 天然占满泳道宽。
//  - 奇数排横向半格错位(六边形堆叠)+ 每人确定性抖动(按 index 哈希,不每帧 random)→ 不规则人堆,非网格。
//  - 单体不缩放(固定 scale=1),人多就往后多堆排(符合该品类惯例:占地表现数量,不缩小单体)。
const PERSON_SPACING = 42;   // 相邻小人间距(略小于单体显示尺寸→人挨人部分重叠,人堆感)
const PERSON_LANE_W = 300;   // 小队可铺开宽度(≈一条泳道宽,一排约7列)
export function personLayout(count: number): { dx: number; dy: number; scale: number }[] {
    const out: { dx: number; dy: number; scale: number }[] = [];
    if (count <= 0) return out;
    const cols = Math.max(1, Math.round(PERSON_LANE_W / PERSON_SPACING));   // 一排最多几列
    const rowH = PERSON_SPACING * 0.87;   // 六边形错排行距(更密)
    const rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols), col = i % cols;
        // 关键:按【该排实际人数】居中(非满列数),否则人少时整堆偏左、与 playerX 判定中心错位。
        const inThisRow = Math.min(cols, count - row * cols);
        let dx = (col - (inThisRow - 1) / 2) * PERSON_SPACING;   // 该排居中对齐 → 单人 dx=0
        if (row % 2 === 1 && inThisRow === cols) dx += PERSON_SPACING * 0.5;   // 满排时奇数排半格错位(六边形)
        // dy:让人堆整体以 playerX 为中心(第0排在最前=最下,往上堆),整堆纵向也大致居中
        let dy = (row - (rows - 1) / 2) * rowH;   // 行居中,堆以中心对称
        // 确定性抖动(按 index 生成,打破规则感)→ "人堆"自然;单人(count=1)不抖,保证正好在 playerX
        if (count > 1) {
            const h1 = Math.sin(i * 12.9898) * 43758.5453; const r1 = h1 - Math.floor(h1);
            const h2 = Math.sin(i * 78.233) * 43758.5453;  const r2 = h2 - Math.floor(h2);
            dx += (r1 - 0.5) * PERSON_SPACING * 0.5;
            dy += (r2 - 0.5) * PERSON_SPACING * 0.5;
        }
        out.push({ dx, dy, scale: 1 });
    }
    return out;
}

// ---- 道具门类型 ----
export const GateType = {
    WEAPON_UP: 'weapon_up', PERSON_UP: 'person_up',
} as const;
export type GateType = typeof GateType[keyof typeof GateType];

// ---- 怪物类型 ----
export const EnemyType = {
    GRUNT: 'grunt', RUNNER: 'runner', BRUTE: 'brute',
    MINI_BOSS: 'mini_boss', BOSS: 'boss',
} as const;
export type EnemyType = typeof EnemyType[keyof typeof EnemyType];

export interface EnemyConfig {
    type: EnemyType;
    hp: number;
    speed: number;     // px/s 向下
    damage: number;    // 到底线伤害
    scoreValue: number;
    radius: number;
}

export const ENEMY_BASE: Record<EnemyType, EnemyConfig> = {
    [EnemyType.GRUNT]:     { type: EnemyType.GRUNT,     hp: 500,   speed: 120, damage: 500,  scoreValue: 10,  radius: 22 },
    [EnemyType.RUNNER]:    { type: EnemyType.RUNNER,    hp: 300,   speed: 220, damage: 500,  scoreValue: 15,  radius: 18 },
    [EnemyType.BRUTE]:     { type: EnemyType.BRUTE,     hp: 3000,  speed: 70,  damage: 1500, scoreValue: 50,  radius: 34 },
    [EnemyType.MINI_BOSS]: { type: EnemyType.MINI_BOSS, hp: 12000, speed: 50,  damage: 2500, scoreValue: 150, radius: 44 },
    [EnemyType.BOSS]:      { type: EnemyType.BOSS,      hp: 40000, speed: 35,  damage: 4000, scoreValue: 500, radius: 60 },
};

// ---- 玩家状态 ----
export interface PlayerState {
    hp: number;
    maxHp: number;
    weaponLevel: WeaponLevel;
    personCount: number;
    score: number;
    level: number;
}

export function makeInitialState(): PlayerState {
    return { hp: 10000, maxHp: 10000, weaponLevel: WeaponLevel.PISTOL, personCount: 1, score: 0, level: 1 };
}

// 当前 DPS = 武器伤害 × 人数 × 射速。水晶血量按此换算
export function computeDps(state: PlayerState): number {
    return weaponDamage(state.weaponLevel) * state.personCount * (1 / SHOOT_INTERVAL);
}
