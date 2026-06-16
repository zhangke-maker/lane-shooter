// 玩家模型 —— 递归前瞻式(receding-horizon planner / depth-limited game tree)，零手写规则偏见
// 业界标准(Browne et al. MCTS综述 / Zook&Riedl 自动游戏测试)：用游戏前向模型规划"未来一串泳道选择"，
// 而非手写 if-else，也不是"假设整段不动"的单路 rollout。
//
// 关键修正（取代旧版「rollout 假设整段 horizon 待同一路」）：
//   旧版 bug：每个候选只算"一路待到底"的终局分 → 评估失真 → noise/decideEverySec 旋钮反向，
//             三档（菜/中/强）无法拉开梯度，甚至"完美评估反而更菜"。
//   新版：bot 在前瞻里把 horizon 切成若干段(segSec)，递归在每个段界重新选左/右，
//         真正模拟"高水平玩家会按时机来回切换"。深度越大=看得越远=打得越好 → 旋钮恢复单调。
// 水平档据此自然映射：planDepth(看几步)=核心技巧轴，segSec(规划粒度)与 noise(误判) 辅助。
import { GameWorld } from '../assets/scripts/core/world';
import {
    LANE_LEFT_X, LANE_RIGHT_X, computeDps,
    GateType, WEAPON_STATS, MAX_WEAPON_LEVEL, MAX_PERSON, SHOOT_INTERVAL,
} from '../assets/scripts/core/types';

export interface Bot {
    name: string;
    decide(w: GameWorld): number;
    reset?(): void;
}

// bot 水平参数：
//   planDepth   前瞻规划几个决策段（越深=看得越远=越强，是核心技巧轴）
//   segSec      每段时长（规划粒度，秒）；planDepth*segSec = 总前瞻时长
//   decideEverySec 多久重规划一次（菜玩家反应慢=大）
//   noise       评估打分噪声（菜玩家判断不准=大）
export interface Skill {
    planDepth: number;
    segSec: number;
    decideEverySec: number;
    noise: number;
}

// 评估世界状态好坏：活着 + 高血 + 高能力(DPS) + 推进关卡。死了重罚。
// 权重要点：DPS 是通关关键杠杆，权重必须高到"刷道具的长期收益"能压过"短期漏怪掉血"，
// 否则前瞻 bot 永远不敢去刷道具（短horizon只见代价不见延迟收益）。
// 进度奖励(gateProgress)：即使道具没打穿，"打掉一部分血"也算收益，缓解延迟兑现问题。
function scoreWorld(w: GameWorld): number {
    if (w.gameOver && !w.won) return -100000;       // 死了
    if (w.won) return 100000;                         // 通关全部
    const hp = w.state.hp;
    const dps = computeDps(w.state);
    const levelBonus = w.state.level * 8000;
    // HP 与 DPS 权重平衡：HP 略高(保命优先)，DPS 中等(成长重要但不盖过生存)
    const base = levelBonus + hp * 90 + dps * 18;
    return base + gateLookaheadValue(w);
}

// 道具门「延迟奖励整形」（potential-based reward shaping，业界标准修法）：
// 致命陷阱——道具门打穿需≈8s，但前瞻 horizon 只有几秒，规划者永远看不到升级完成、只见离开右路的代价，
// 于是深度越大越自信地 camp 右路、停手枪、第2关被刷（实测复现）。
// 解法：给【当前可打的门】按已打进度，预支这次升级将带来的 DPS 增益价值（用与 dps 同权重 *18 计），
// 让"打了一半道具"在 horizon 内就被看见为成长，bot 才会像真人高手那样肯去左路投资。
function gateLookaheadValue(w: GameWorld): number {
    const g = w.gates.find(gg => (gg.slot === 0 || gg.freeDrop) && gg.hp < gg.maxHp);
    if (!g) return 0;
    const progress = 1 - g.hp / g.maxHp;            // 0~1 已打掉比例
    const st = w.state;
    let dpsGain = 0;                                  // 这次门打穿后净增的 DPS
    if (g.type === GateType.WEAPON_UP && st.weaponLevel < MAX_WEAPON_LEVEL) {
        const next = WEAPON_STATS[st.weaponLevel + 1].damage - WEAPON_STATS[st.weaponLevel].damage;
        dpsGain = next * st.personCount * (1 / SHOOT_INTERVAL);
    } else if (g.type === GateType.PERSON_UP && st.personCount < MAX_PERSON) {
        dpsGain = WEAPON_STATS[st.weaponLevel].damage * (1 / SHOOT_INTERVAL);  // +1 人 = +1 份火力
    } else if (g.type === GateType.HEAL) {
        return progress * (g.healAmount ?? 30) * 90;  // 补血门按 HP 权重折算
    }
    // 按 dps 同权重(*18) 预支增益；进度平方让"快打穿"边际更高、避免浅尝辄止刷半截就走
    return progress * progress * dpsGain * 18;
}

// 把世界 sim 沿 targetX 推进 segSec 秒（原地修改 sim）。返回 false 表示中途死亡/结束。
function advance(sim: GameWorld, targetX: number, segSec: number): boolean {
    const dt = 1 / 30;  // 粗步长省算力，够准
    const steps = Math.floor(segSec / dt);
    for (let i = 0; i < steps; i++) {
        if (!sim.running) return false;
        sim.step(dt, { playerTargetX: targetX });
    }
    return sim.running;
}

// 递归前瞻：从 sim 出发，往 firstX 走一段，再在剩余 depth-1 段里递归选最优左/右，
// 返回这条最优规划链的终局评分（minimax 里的 max 节点——bot 自己选最好的未来）。
// depth=剩余决策段数。这是修正的核心：未来允许换路，深度越大评估越接近真实最优。
function planScore(sim: GameWorld, firstX: number, depth: number, segSec: number): number {
    advance(sim, firstX, segSec);
    if (!sim.running || depth <= 1) return scoreWorld(sim);
    // 还能继续看：分别试"下一段去左/去右"，取更优的那条未来
    const bestL = planScore(sim.clone(), LANE_LEFT_X, depth - 1, segSec);
    const bestR = planScore(sim.clone(), LANE_RIGHT_X, depth - 1, segSec);
    return Math.max(bestL, bestR);
}

// 前瞻 bot 工厂
export function makeLookaheadBot(skill: Skill, seed = 12345): Bot {
    let lastDecideT = -99;
    let chosenX = LANE_RIGHT_X;
    // bot 自己的随机源（评估噪声用），与世界 rng 独立
    let s = seed >>> 0;
    const rng = () => { s = (s + 0x9E3779B9) | 0; let t = Math.imul(s ^ (s >>> 16), 0x45d9f3b); t = Math.imul(t ^ (t >>> 16), 0x45d9f3b); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
    return {
        name: `LA(depth=${skill.planDepth},seg=${skill.segSec},n=${skill.noise})`,
        reset() { lastDecideT = -99; chosenX = LANE_RIGHT_X; },
        decide(w: GameWorld): number {
            if (w.levelTime - lastDecideT >= skill.decideEverySec) {
                lastDecideT = w.levelTime;
                // 候选首步：去右路打怪 / 去左路刷道具。各自递归规划未来 planDepth 段、取最优未来，打分、选最优首步
                const scoreR = planScore(w.clone(), LANE_RIGHT_X, skill.planDepth, skill.segSec) + (rng() - 0.5) * skill.noise;
                const scoreL = planScore(w.clone(), LANE_LEFT_X, skill.planDepth, skill.segSec) + (rng() - 0.5) * skill.noise;
                // 切换迟滞：换泳道要明显更优(>SWITCH_MARGIN)才切。
                // 对应真实的移动火力损失——频繁横跳本就该被惩罚，与游戏机制一致。
                // ⚠️ margin 必须与实际分差量级匹配：道具升级的延迟收益在 horizon 内只体现为约几十分的边际优势，
                // 旧值 1500 比真实分差大 60×，导致 bot 永远跨不过门槛去刷道具、停手枪 camp 右路（实测复现）。
                const cur = chosenX < -50 ? 'L' : 'R';
                const SWITCH_MARGIN = 600;
                if (cur === 'R' && scoreL > scoreR + SWITCH_MARGIN) chosenX = LANE_LEFT_X;
                else if (cur === 'L' && scoreR > scoreL + SWITCH_MARGIN) chosenX = LANE_RIGHT_X;
                // 否则保持当前泳道（迟滞）
            }
            return chosenX;
        },
    };
}

// 预设水平档（菜/中/强）—— 核心梯度在 planDepth（看几步）+ noise（判得准不准），二者真实相关：
//   高手：看 4 步、几乎不误判、反应快 → 敢按时机来回切换刷道具又守住右路
//   普通：看 3 步、中等误判
//   菜鸟：只看 1 步（=短视"一路待到底"）、大误判、反应慢
// 注：avgReach 在菜/普间区分有限——因游戏前3关本就可survive（设计如此），早期生存有"地板"，
// 真正拉开梯度的是【整体通关率】与【高手单关通关率】，见 winrate.ts 曲线（高手>90%@L1、全程<5%）。
export const SKILL_NOVICE: Skill = { planDepth: 1, segSec: 1.6, decideEverySec: 1.4, noise: 40000 };
export const SKILL_AVERAGE: Skill = { planDepth: 3, segSec: 1.6, decideEverySec: 0.7, noise: 5000 };
export const SKILL_EXPERT: Skill = { planDepth: 4, segSec: 1.5, decideEverySec: 0.4, noise: 800 };
