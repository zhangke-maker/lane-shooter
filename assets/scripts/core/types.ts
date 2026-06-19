// 纯逻辑核心：常量、类型、数值配置
// 零 cc 依赖 —— node 可直接 `node xxx.ts` 运行，Cocos 渲染层也 import 同一份
// 坐标系沿用 Cocos UI：原点屏幕中心，X∈[-375,375] Y∈[-667,667]

// ---- 几何 / 边界 ----
export const LANE_LEFT_X = -190;   // 左路（道具）中心
export const LANE_RIGHT_X = 190;   // 右路（怪物）中心
export const SCREEN_TOP = 667;
export const PLAYER_Y = -520;
export const PLAYER_MIN_X = LANE_LEFT_X;
export const PLAYER_MAX_X = LANE_RIGHT_X;
export const BASELINE_Y = -540;    // 怪到此 Y 触发扣血
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
export const WEAPON_STATS: WeaponStat[] = [
    { damage: 1,  bulletWidth: 4,  color: '#FFFFFF' },   // 手枪 白
    { damage: 2,  bulletWidth: 6,  color: '#F9E784' },   // 冲锋枪 黄
    { damage: 4,  bulletWidth: 8,  color: '#F5A623' },   // 步枪 橙
    { damage: 8,  bulletWidth: 12, color: '#E5484D' },   // 机枪 红
    { damage: 16, bulletWidth: 16, color: '#9B59E0' },   // 重机枪 紫
    { damage: 32, bulletWidth: 20, color: '#3FE0D0' },   // 激光 青
];
// 武器伤害（无上限）= 2^level。超过专属档(5)继续翻倍。
export function weaponDamage(level: number): number { return Math.pow(2, level); }
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

// 动态布局：把任意 count 个小人以玩家为中心【圆形同心环】铺开，返回每个的 [dx, dy, scale]。
// 渲染画小人 + 弹道发射点共用(同源避免错位)。设计：
//  - 人越多单体越小(scale 随 count 衰减,下限 0.4,不会小到看不见),靠重叠+占地扩大表现"人多"。
//  - 整体占地半径随 sqrt(count) 增长(占地面积 ∝ 人数,符合"角色占地面积随人数增加")。
//  - 同心环:中心1个,外面一圈圈,每环周长容纳的人数随半径增长。
export function personLayout(count: number): { dx: number; dy: number; scale: number }[] {
    const out: { dx: number; dy: number; scale: number }[] = [];
    if (count <= 0) return out;
    // 单体缩放:1 人时 0.85,人越多越小,下限 0.4。用 1/sqrt 衰减。
    const scale = Math.max(0.4, Math.min(0.85, 1.2 / Math.sqrt(count)));
    const unit = PERSON_BASE_RADIUS * scale * 1.7;   // 相邻小人间距(略大于直径,密集但能分辨)
    out.push({ dx: 0, dy: 0, scale });               // 中心 1 个
    let placed = 1, ring = 1;
    while (placed < count) {
        const ringR = unit * ring;                    // 第 ring 环半径
        const cap = Math.floor((2 * Math.PI * ringR) / unit);   // 本环按周长能放几个
        const n = Math.min(cap, count - placed);
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + ring * 0.6;   // 每环旋转错位,避免径向对齐
            out.push({ dx: Math.cos(a) * ringR, dy: Math.sin(a) * ringR, scale });
        }
        placed += n; ring++;
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
    [EnemyType.GRUNT]:     { type: EnemyType.GRUNT,     hp: 5,   speed: 120, damage: 5,  scoreValue: 10,  radius: 22 },
    [EnemyType.RUNNER]:    { type: EnemyType.RUNNER,    hp: 3,   speed: 220, damage: 5,  scoreValue: 15,  radius: 18 },
    [EnemyType.BRUTE]:     { type: EnemyType.BRUTE,     hp: 30,  speed: 70,  damage: 15, scoreValue: 50,  radius: 34 },
    [EnemyType.MINI_BOSS]: { type: EnemyType.MINI_BOSS, hp: 120, speed: 50,  damage: 25, scoreValue: 150, radius: 44 },
    [EnemyType.BOSS]:      { type: EnemyType.BOSS,      hp: 400, speed: 35,  damage: 40, scoreValue: 500, radius: 60 },
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
    return { hp: 100, maxHp: 100, weaponLevel: WeaponLevel.PISTOL, personCount: 1, score: 0, level: 1 };
}

// 当前 DPS = 武器伤害 × 人数 × 射速。水晶血量按此换算
export function computeDps(state: PlayerState): number {
    return weaponDamage(state.weaponLevel) * state.personCount * (1 / SHOOT_INTERVAL);
}
