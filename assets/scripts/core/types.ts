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
export const MAX_WEAPON_LEVEL = WeaponLevel.LASER;

export const WEAPON_NAMES = ['手枪', '冲锋枪', '步枪', '机枪', '重机枪', '激光'];
export interface WeaponStat { damage: number; bulletWidth: number; color: string; }
export const WEAPON_STATS: WeaponStat[] = [
    { damage: 1,  bulletWidth: 4,  color: '#FFE066' },
    { damage: 2,  bulletWidth: 6,  color: '#FFB830' },
    { damage: 4,  bulletWidth: 8,  color: '#FF8C00' },
    { damage: 8,  bulletWidth: 12, color: '#FF5500' },
    { damage: 16, bulletWidth: 16, color: '#FF2200' },
    { damage: 50, bulletWidth: 20, color: '#00FFFF' },
];

// ---- 人数 ----
export const MAX_PERSON = 10;
// 每个小人相对偏移（最多10个，3排）—— 渲染与弹道共用
export const PERSON_OFFSETS: [number, number][] = [
    [0, 0],
    [-28, -20], [28, -20],
    [-28, 20],  [28, 20],
    [-56, -20], [56, -20],
    [-56, 20],  [56, 20],
    [0, -40],
];

// ---- 道具门类型 ----
export const GateType = {
    WEAPON_UP: 'weapon_up', PERSON_UP: 'person_up', HEAL: 'heal',
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
    healDrop: boolean;
    radius: number;
}

export const ENEMY_BASE: Record<EnemyType, EnemyConfig> = {
    [EnemyType.GRUNT]:     { type: EnemyType.GRUNT,     hp: 5,   speed: 120, damage: 5,  scoreValue: 10,  healDrop: false, radius: 22 },
    [EnemyType.RUNNER]:    { type: EnemyType.RUNNER,    hp: 3,   speed: 220, damage: 5,  scoreValue: 15,  healDrop: false, radius: 18 },
    [EnemyType.BRUTE]:     { type: EnemyType.BRUTE,     hp: 30,  speed: 70,  damage: 15, scoreValue: 50,  healDrop: false, radius: 34 },
    [EnemyType.MINI_BOSS]: { type: EnemyType.MINI_BOSS, hp: 120, speed: 50,  damage: 25, scoreValue: 150, healDrop: true,  radius: 44 },
    [EnemyType.BOSS]:      { type: EnemyType.BOSS,      hp: 400, speed: 35,  damage: 40, scoreValue: 500, healDrop: true,  radius: 60 },
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
    return WEAPON_STATS[state.weaponLevel].damage * state.personCount * (1 / SHOOT_INTERVAL);
}
