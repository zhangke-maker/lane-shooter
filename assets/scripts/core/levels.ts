// 关卡配置 —— 难度模型：固定难度墙 + 每局随机形态（破唯一最优解）
// 威胁曲线 Threat(关卡,t) 按绝对时间持续加压、不等人；怪血另叠乘 world._dpsChase 抗成长通胀（不平趟）
// 零 cc 依赖。详见记忆 lane-shooter-difficulty-design（反解法/精确容错整套已作废，勿复活）
import { EnemyType, GateType } from './types';

// 威胁曲线关键帧：在 atSec 时刻，潮水强度为 intensity
// intensity 同时驱动：出怪速率(只/秒) 和 怪血量倍率。线性插值，形成疏密多变的潮水
export interface ThreatKey {
    atSec: number;
    spawnRate: number;   // 每秒出怪数
    hpMul: number;       // 怪血量倍率（基于 ENEMY_BASE）
}

export interface LevelDef {
    levelIndex: number;
    durationSec: number;          // 本关总时长（到此 Boss 出现并需击杀）
    threat: ThreatKey[];          // 威胁曲线关键帧
    enemyPool: EnemyType[];       // 本关潮水怪种类（按 hpMul 缩放）
    bossType: EnemyType;          // 关底 Boss（durationSec 时出现，杀掉=通关）
    bossHp: number;               // Boss 绝对血量（反算）
    gateSeconds: Record<GateType, number>;  // 道具击破秒数（×当前DPS=血量，保证可中断）
}

// 在时刻 t 插值威胁曲线
export function threatAt(def: LevelDef, t: number): { spawnRate: number; hpMul: number } {
    const ks = def.threat;
    if (t <= ks[0].atSec) return { spawnRate: ks[0].spawnRate, hpMul: ks[0].hpMul };
    for (let i = 1; i < ks.length; i++) {
        if (t <= ks[i].atSec) {
            const a = ks[i - 1], b = ks[i];
            const f = (t - a.atSec) / (b.atSec - a.atSec || 1);
            return {
                spawnRate: a.spawnRate + (b.spawnRate - a.spawnRate) * f,
                hpMul: a.hpMul + (b.hpMul - a.hpMul) * f,
            };
        }
    }
    const last = ks[ks.length - 1];
    return { spawnRate: last.spawnRate, hpMul: last.hpMul };
}

// 5 关配置（清场后骨架，step2 改为「固定上限+随机形态」）。
// ⚠️ 连续闯关：一条命从第1关打到第5关，能力跨关累积，不能选关，死了回第1关。
// 难度上限固定递增、威胁形态每局随机；通关率前3关高、第4-5关刷掉绝大多数。
export const LEVEL_DEFS: LevelDef[] = [
    // ── 第1关：教学关(32s)。手枪×1 入。加长+首道具便宜，保底让玩家进L2前刷到1次升级
    // (实测旧22s+贵道具→近半人裸手枪进L2=L2墙根因)。weapon_up 仅5s打穿，鼓励早去左路学双路取舍 ──
    {
        levelIndex: 1, durationSec: 26,
        enemyPool: [EnemyType.GRUNT],
        bossType: EnemyType.BRUTE, bossHp: 40,
        gateSeconds: { [GateType.WEAPON_UP]: 6, [GateType.PERSON_UP]: 5, [GateType.HEAL]: 4 },
        threat: [
            { atSec: 0,  spawnRate: 0.56, hpMul: 1.02 },
            { atSec: 14, spawnRate: 0.95, hpMul: 1.42 },
            { atSec: 26, spawnRate: 1.37, hpMul: 1.86 },
        ],
    },
    // ── 第2关：30s。补课/喘息关——玩家刚过L1 boss、已有升级，威胁温和(spawnRate低)让其稳固。
    // 道具便宜(weapon 6s)继续快速升级。单关通过~78%(目标)。 ──
    {
        levelIndex: 2, durationSec: 30,
        enemyPool: [EnemyType.GRUNT, EnemyType.RUNNER],
        bossType: EnemyType.BRUTE, bossHp: 90,
        gateSeconds: { [GateType.WEAPON_UP]: 6, [GateType.PERSON_UP]: 5, [GateType.HEAL]: 5 },
        threat: [
            { atSec: 0,  spawnRate: 0.40, hpMul: 0.45 },
            { atSec: 15, spawnRate: 0.55, hpMul: 0.60 },
            { atSec: 30, spawnRate: 0.72, hpMul: 0.78 },
        ],
    },
    // ── 第3关：42s。第一道真墙(单关~65%)。威胁陡升+怪血靠 _dpsChase 叠乘抗通胀(强者怪更硬→仍掉血) ──
    {
        levelIndex: 3, durationSec: 42,
        enemyPool: [EnemyType.GRUNT, EnemyType.RUNNER],
        bossType: EnemyType.MINI_BOSS, bossHp: 200,
        gateSeconds: { [GateType.WEAPON_UP]: 10, [GateType.PERSON_UP]: 8, [GateType.HEAL]: 6 },
        threat: [
            { atSec: 0,  spawnRate: 0.66, hpMul: 0.71 },
            { atSec: 20, spawnRate: 0.93, hpMul: 0.98 },
            { atSec: 42, spawnRate: 1.27, hpMul: 1.33 },
        ],
    },
    // ── 第4关：54s。开始刷人(全程<5%)。出怪量加压，怪血靠 _dpsChase 追玩家 ──
    {
        levelIndex: 4, durationSec: 54,
        enemyPool: [EnemyType.RUNNER, EnemyType.BRUTE],
        bossType: EnemyType.MINI_BOSS, bossHp: 340,
        gateSeconds: { [GateType.WEAPON_UP]: 11, [GateType.PERSON_UP]: 9, [GateType.HEAL]: 6 },
        threat: [
            { atSec: 0,  spawnRate: 0.71, hpMul: 0.66 },
            { atSec: 26, spawnRate: 1.01, hpMul: 0.88 },
            { atSec: 54, spawnRate: 1.36, hpMul: 1.14 },
        ],
    },
    // ── 第5关：66s。终关高压墙，绝大多数死这(全程<5%) ──
    {
        levelIndex: 5, durationSec: 66,
        enemyPool: [EnemyType.RUNNER, EnemyType.BRUTE],
        bossType: EnemyType.BOSS, bossHp: 520,
        gateSeconds: { [GateType.WEAPON_UP]: 12, [GateType.PERSON_UP]: 10, [GateType.HEAL]: 7 },
        threat: [
            { atSec: 0,  spawnRate: 1.00, hpMul: 0.85 },
            { atSec: 30, spawnRate: 1.42, hpMul: 1.18 },
            { atSec: 66, spawnRate: 1.90, hpMul: 1.55 },
        ],
    },
];

// 道具序列（循环）—— 决定传送带补入顺序
// 补血低频低量（潮水为主要伤害源）：8 个里仅 2 个补血
export const GATE_SEQUENCE: { type: GateType; label: string; healAmount?: number }[] = [
    { type: GateType.WEAPON_UP, label: '武器升级' },
    { type: GateType.PERSON_UP, label: '+1 人' },
    { type: GateType.WEAPON_UP, label: '武器升级' },
    { type: GateType.HEAL, label: '+30 血', healAmount: 30 },
    { type: GateType.PERSON_UP, label: '+1 人' },
    { type: GateType.WEAPON_UP, label: '武器升级' },
    { type: GateType.HEAL, label: '+30 血', healAmount: 30 },
    { type: GateType.PERSON_UP, label: '+1 人' },
];
