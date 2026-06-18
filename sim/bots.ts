// 玩家模型 —— 极限刷道具策略(greedy edge-farming policy)，匹配命中模型「占领某路=对该路全体输出」。
// 真实玩家心智(用户实测口径，逐字)：
//   "我当前火力能顶住兵线、兵线缓慢后移，我就去刷道具；直到怪马上要贴到我扣血才回去刷怪；
//    稍微顶起一点就立刻又去刷道具，用非常极限的方式刷道具提升 DPS。"
// → 核心信号是【兵线速度(最前排怪的移动方向)】，不是怪海存量：
//   兵线后移(DPS≥出怪速率) → 刷道具；兵线前移且压到贴脸线 → 脉冲回防顶一下；
//   兵线一转后移(顶起一点) → 立刻回去刷。怪海多厚不影响决策。
// 目标函数：在"兵线不破(不漏怪扣血)"约束下，最大化刷道具时间。
// 水平档 = 对兵线趋势的判断准度 → 操作极限程度：
//   高手判断准 → 敢贴到几乎扣血才回防(贴脸线极近)+反应快+几乎不误判趋势 → 刷得最满、DPS 雪球最大
//   菜鸟判断差 → 兵线还远就慌着回防(贴脸线远)+反应慢+误判趋势 → 刷不够、雪球小、被威胁曲线压死
import { GameWorld } from '../assets/scripts/core/world';
import {
    LANE_LEFT_X, LANE_RIGHT_X, BASELINE_Y,
} from '../assets/scripts/core/types';

export interface Bot {
    name: string;
    decide(w: GameWorld): number;
    reset?(): void;
}

// bot 水平参数（极限刷道具型）：
//   reactSec    反应/重决策周期（判断慢=大；高手小）
//   trendNoise  对兵线速度(前移/后移)的判断误差（看不准趋势=大，0~1 相对扰动；高手≈0）
//   edgeFrac    贴脸线 = 屏顶到底线全程的占比。兵线前移且压进此线内才回防。
//               越小=越敢贴脸(让怪逼到几乎扣血才回防)=操作越极限=刷得越满。高手小、菜鸟大。
export interface Skill {
    reactSec: number;
    trendNoise: number;
    edgeFrac: number;
}

// 当前 slot0 是否有道具可刷。升级无上限,只要有门就值得刷(每次都 ×2 增益)。
function gateWorthFarming(w: GameWorld): boolean {
    return w.gates.some(gg => gg.slot === 0);
}

// 最前排怪离底线的【绝对距离】（像素）。怪 y 越小越靠近底线 BASELINE_Y。
// 没怪 = 兵线无威胁，返回 Infinity。已压到底线 = 0。
function frontGap(w: GameWorld): number {
    let minY = Infinity;
    for (const e of w.enemies) if (e.y < minY) minY = e.y;
    if (minY === Infinity) return Infinity;
    return Math.max(0, minY - BASELINE_Y);
}

// 极限刷道具 bot 工厂。
// 决策迟滞：决定回防/回刷后【承诺】到状态条件反转，不每帧横跳(横跳=移动半火力，实测更弱)。
export function makeStrategyBot(skill: Skill, seed = 12345): Bot {
    let lastDecideT = -99;
    let chosenX = LANE_LEFT_X;        // 默认刷道具(贪婪)：开局就去左路
    let prevGap = Infinity;           // 上次决策时的兵线距离（用于算速度=趋势）
    let s = seed >>> 0;
    const rng = () => { s = (s + 0x9E3779B9) | 0; let t = Math.imul(s ^ (s >>> 16), 0x45d9f3b); t = Math.imul(t ^ (t >>> 16), 0x45d9f3b); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
    // 贴脸线绝对距离 = 全程(屏顶-底线) × edgeFrac。兵线前移且压进此线 → 回防。
    const fullSpan = 667 - BASELINE_Y;   // SCREEN_TOP(667) 到 BASELINE_Y 的总落差
    const edgeGap = fullSpan * skill.edgeFrac;
    // committed: 'farm'=正占左路刷道具；'defend'=正占右路压兵线
    let committed: 'farm' | 'defend' = 'farm';
    return {
        name: `Edge(react=${skill.reactSec},noise=${skill.trendNoise},edge=${skill.edgeFrac})`,
        reset() { lastDecideT = -99; chosenX = LANE_LEFT_X; prevGap = Infinity; committed = 'farm'; },
        decide(w: GameWorld): number {
            if (w.levelTime - lastDecideT >= skill.reactSec) {
                lastDecideT = w.levelTime;
                const gap = frontGap(w);
                // 兵线速度 = 本次与上次距离之差（带判断误差）。>0 后移(DPS够,兵线在退)，<0 前移(怪压上来)。
                const rawTrend = (gap === Infinity || prevGap === Infinity) ? 1 : (gap - prevGap);
                const trend = rawTrend * (1 + (rng() - 0.5) * 2 * skill.trendNoise);
                prevGap = gap;

                // 道具满级：左路无意义，纯打怪
                if (!gateWorthFarming(w)) { committed = 'defend'; chosenX = LANE_RIGHT_X; }
                // 贴脸保险：兵线已压进贴脸线 → 必守（不管趋势，防贴脸瞬间送命）
                else if (gap <= edgeGap) { committed = 'defend'; chosenX = LANE_RIGHT_X; }
                else if (committed === 'defend') {
                    // 守家顶兵线中：只要兵线转为后移(顶起一点了)→ 立刻回去刷（极限：不等顶回安全区）
                    if (trend > 0) { committed = 'farm'; chosenX = LANE_LEFT_X; }
                    else chosenX = LANE_RIGHT_X;
                } else {
                    // 刷道具中(默认贪婪)：兵线在前移(顶不住,怪压上来)→ 回防；后移/持平→继续刷
                    if (trend < 0) { committed = 'defend'; chosenX = LANE_RIGHT_X; }
                    else chosenX = LANE_LEFT_X;
                }
            }
            return chosenX;
        },
    };
}

// 预设水平档（菜/中/高）—— 差异 = 对兵线趋势的判断准度 → 操作极限程度：
//   高手：判断准(trendNoise≈0)+反应快(reactSec 小)+敢贴到几乎扣血才回防(edgeFrac 小=极限)→刷最满
//   普通：判断有偏差+反应中等+兵线还较远就回防(edgeFrac 中)→刷得够用不极限
//   菜鸟：判断差(误判趋势)+反应慢+早早慌着回防(edgeFrac 大=保守)→刷不够，雪球小，后期被威胁曲线压死
export const SKILL_NOVICE: Skill  = { reactSec: 0.45, trendNoise: 0.5,  edgeFrac: 0.30 };
export const SKILL_AVERAGE: Skill = { reactSec: 0.28, trendNoise: 0.25, edgeFrac: 0.16 };
export const SKILL_EXPERT: Skill  = { reactSec: 0.13, trendNoise: 0.05, edgeFrac: 0.07 };
