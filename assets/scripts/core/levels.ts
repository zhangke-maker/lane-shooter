// 关卡配置 —— 难度模型：固定难度墙 + 每局随机形态（破唯一最优解）
// 威胁曲线 Threat(关卡,t)：怪血/出怪量按【固定时间线】递增，**不挂玩家DPS**——怪自顾自变强，
// 玩家必须靠升级追上(裸装活不过第1关)。零 cc 依赖。详见记忆 lane-shooter-difficulty-design
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
    gateSeconds: Record<GateType, number>;  // 道具打穿需多少秒（满火力恒定时长，与DPS无关）
    hordeDensity?: number;        // 怪海密度(出怪量×N、单只血÷N)。默认 24(填满右路)；
                                  // L1 怪极脆,÷24 后单只血触底 Math.max(1,...) 破坏守恒→难度虚高3×,故 L1 单独用 8。
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
    // ── 第1关：教学关(26s)。裸装手枪入。开局怪海少(给刷首把武器的活路)→末段加压逼升级 ──
    {
        levelIndex: 1, durationSec: 26,
        enemyPool: [EnemyType.GRUNT],
        bossType: EnemyType.BRUTE, bossHp: 12000,
        hordeDensity: 24,   // L1 怪极脆,用低值(原8)避开血量地板破坏守恒;随全局×3同步到24保持原比例
        // 教学关：给~5秒抓首把武器(首道具便宜)，之后怪海迅速压上——逼"刷 vs 守"取舍，不能无脑刷满。
        // 道具耗时加大(A+C)：刷满要冒漏怪风险且更久，治"前期轻松刷满质变碾压"。
        gateSeconds: { [GateType.WEAPON_UP]: 7, [GateType.PERSON_UP]: 6 },
        // 第1关按【裸装手枪DPS8】基准:开局怪海远低于8(给刷首把武器的活路),末段升到~8(裸装勉强,逼升级)。
        // 怪海/秒 = spawnRate×baseHp(5)×hpMul。开局~3/秒, 末段~8/秒。
        // hpMul ×0.8(原 3.66/4.03/3.48)：降低 L1 整体难度。配合开局预置怪在半屏(world._beginLevel)，
        // 堵"开局无脑跑去长时间刷道具"的投机策略——一上来就得先守右路打怪,不能开局摆烂刷。
        threat: [
            { atSec: 0, spawnRate: 0.30, hpMul: 2 },
            { atSec: 8, spawnRate: 0.55, hpMul: 2 },
            { atSec: 26, spawnRate: 0.90, hpMul: 2 },
        ],
    },
    // ── 第2关：30s。轻度加压(原零难度)。怪血 ×2(原≈6.6→13)：微压力但不卡刷道具节奏。──
    // ×3.5 实测过头(L2 玩家 DPS 还在冲锋枪级,加压太狠→没空刷→DPS 卡死→清不动堆死,同 L3×8 翻车机制)。
    // L2 玩家 DPS 起步低,加压容忍度远低于 L3,只需消除"零难度"不需要很难。
    // 注意全局耦合：L2 加压会挤占刷道具时间→进 L3+ 的 DPS 下移→L3-L5 难度需跟着下调匹配(本版 L3-L5 已下调)。
    {
        levelIndex: 2, durationSec: 30,
        enemyPool: [EnemyType.GRUNT, EnemyType.RUNNER],
        bossType: EnemyType.BRUTE, bossHp: 120000,
        gateSeconds: { [GateType.WEAPON_UP]: 12, [GateType.PERSON_UP]: 10 },
        threat: [
            { atSec: 0, spawnRate: 0.68, hpMul: 30 },
            { atSec: 15, spawnRate: 0.92, hpMul: 30 },
            { atSec: 30, spawnRate: 1.22, hpMul: 30 },
        ],
    },
    // ── 第3关：42s。险过关——目标 HP 打到见底但能过。──
    // 关键机制(实测修正)：DPS 只打"第一排"(最靠下80px带)，漏不漏怪取决于"清第一排耗时 vs 怪落地耗时"，
    // 不取决于全屏总血量。第一排血 ∝ spawnRate×baseHp×hpMul(与 HORDE_DENSITY 无关)。要逼出 HP 损耗，
    // 必须让"清第一排耗时"逼近"落地耗时(~7s)"——即第一排血量逼近 DPS×7。
    // 实测迭代：×4.5 无损 / ×8 过头(怪海压力大到玩家没空刷道具→DPS卡冲锋枪→恶性循环死) → 取中 ×5.5(≈65)。
    // 怪速不动(L1 已是最难,全局提速会破坏 L1)。
    {
        levelIndex: 3, durationSec: 42,
        enemyPool: [EnemyType.GRUNT, EnemyType.RUNNER],
        bossType: EnemyType.MINI_BOSS, bossHp: 600000,
        gateSeconds: { [GateType.WEAPON_UP]: 20, [GateType.PERSON_UP]: 16 },
        threat: [
            { atSec: 0, spawnRate: 1.19, hpMul: 90 },
            { atSec: 20, spawnRate: 1.68, hpMul: 90 },
            { atSec: 42, spawnRate: 2.28, hpMul: 90 },
        ],
    },
    // ── 第4关：54s。【难度墙/skill gate】——第一排清不动+清不完，必死。──
    // hpMul ×14(原≈9.4→132)：第一排血量超过 DPS×落地耗时 → 清第一排比怪落地慢 → 持续漏怪 → 必死。
    {
        levelIndex: 4, durationSec: 54,
        enemyPool: [EnemyType.RUNNER, EnemyType.BRUTE],
        bossType: EnemyType.MINI_BOSS, bossHp: 3000000,
        gateSeconds: { [GateType.WEAPON_UP]: 22, [GateType.PERSON_UP]: 18 },
        threat: [
            { atSec: 0, spawnRate: 1.26, hpMul: 300 },
            { atSec: 26, spawnRate: 1.8, hpMul: 300 },
            { atSec: 54, spawnRate: 2.42, hpMul: 300 },
        ],
    },
    // ── 第5关：66s。终墙(中等偏上玩家在 L4 已死,本关仅占位/极限高手才到)。hpMul ×20。──
    {
        levelIndex: 5, durationSec: 66,
        enemyPool: [EnemyType.RUNNER, EnemyType.BRUTE],
        bossType: EnemyType.BOSS, bossHp: 12000000,
        gateSeconds: { [GateType.WEAPON_UP]: 24, [GateType.PERSON_UP]: 20 },
        threat: [
            { atSec: 0, spawnRate: 0.76, hpMul: 1000 },
            { atSec: 30, spawnRate: 1.08, hpMul: 1000 },
            { atSec: 66, spawnRate: 1.43, hpMul: 1000 },
        ],
    },
];

// 道具序列（循环）—— 决定传送带补入顺序
// 无补血（血是纯消耗资源、只减不加）；只有攻击道具：武器升级 + 加人。
// 道具升级总量是稀缺资源，需玩家横跨 5 关精打细算分配（不能轻易刷满）。
export const GATE_SEQUENCE: { type: GateType; label: string }[] = [
    { type: GateType.WEAPON_UP, label: '武器升级' },
    { type: GateType.PERSON_UP, label: '+1 人' },
    { type: GateType.WEAPON_UP, label: '武器升级' },
    { type: GateType.PERSON_UP, label: '+1 人' },
];
