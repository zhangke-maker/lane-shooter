// 通关率验证体系 —— 业界标准(Zook&Riedl)：多水平 bot × 多随机种子 → 每关通关率曲线
// 难度达标 = 通关率随机种子下稳定逐关下降(前期高、第4-5关<5%)，而非看运气。
// 用法：./sim/run.sh winrate.ts [局数N]
import { GameWorld } from '../assets/scripts/core/world';
import { makeLookaheadBot, SKILL_NOVICE, SKILL_AVERAGE, SKILL_EXPERT } from './bots';
import type { Skill } from './bots';

const N = parseInt(process.argv[2] || '40', 10);  // 每档每关跑多少局
const DT = 1 / 60, MAX_SEC = 260;

// 跑一条命，返回到达的最高关 + 是否通关全5关
function runLife(skill: Skill, seed: number): { reached: number; won: boolean } {
    const w = new GameWorld(); w.start(1, seed);
    const bot = makeLookaheadBot(skill, seed); bot.reset?.();
    let reached = 1;
    for (let f = 0; f < MAX_SEC / DT && w.running; f++) {
        const ev = w.step(DT, { playerTargetX: bot.decide(w) });
        for (const e of ev) if (e.kind === 'level_start') reached = e.level;
    }
    return { reached: w.won ? 5 : reached, won: w.won };
}

// 统计一个水平档。返回两套指标：
//  ① 单关条件通关率 cleared[lv]/reached[lv]：表「到达该关的人里多少过」=单关难度。
//     ⚠️ 后关样本少且有幸存者偏差（能到第5关的菜鸟本就是变强的幸运儿），数字会虚高，仅供看单关陡峭度。
//  ② 累计到达率 reached[lv]/N：表「全部局里多少打到了第lv关」。无样本偏差、按构造单调，
//     是【可信的水平梯度】——高手该条曲线整条压在普通/菜鸟之上。
function profile(name: string, skill: Skill) {
    const reached = [0, 0, 0, 0, 0, 0];   // 1..5：到达第lv关的局数
    const cleared = [0, 0, 0, 0, 0, 0];   // 1..5：通过第lv关的局数
    for (let seed = 1; seed <= N; seed++) {
        const r = runLife(skill, seed * 7919 + 13);
        for (let lv = 1; lv <= r.reached; lv++) reached[lv]++;
        for (let lv = 1; lv < r.reached; lv++) cleared[lv]++;
        if (r.won) cleared[5]++;
    }
    const cond = [name.padEnd(8)];   // 条件通关率行
    const cum = [''.padEnd(8)];      // 累计到达率行
    for (let lv = 1; lv <= 5; lv++) {
        const rate = reached[lv] > 0 ? (cleared[lv] / reached[lv] * 100) : 0;
        cond.push(`${rate.toFixed(0).padStart(3)}%`);
        cum.push(`${(reached[lv] / N * 100).toFixed(0).padStart(3)}%`);
    }
    const overall = (cleared[5] / N * 100).toFixed(0);
    cond.push(`  全程${overall}%`);
    cum.push('');
    console.log(cond.join(' | '));
    console.log('\x1b[2m' + cum.join(' | ') + '  ←累计到达率\x1b[0m');
}

console.log(`===== 通关率曲线（每档每关 ${N} 局，前瞻bot×随机种子）=====\n`);
console.log('每档两行：上=单关条件通关率(到达者中通过比例)，下=累计到达率(全部局打到该关比例,灰)。');
console.log('水平    | 第1关 | 第2关 | 第3关 | 第4关 | 第5关 | 全5关');
console.log('--------|-------|-------|-------|-------|-------|------');
profile('菜鸟', SKILL_NOVICE);
profile('普通', SKILL_AVERAGE);
profile('高手', SKILL_EXPERT);
console.log('\n目标：高手单关>90%@前关、全程<5%；可信梯度看【累计到达率】高手整条>普通>菜鸟。');
console.log('每格=到达该关的人里通过的比例（单关难度）。');
