// 数值调参器 —— 用通关率驱动，逐关二分威胁系数命中目标"高手通关率"
// 目标曲线(高手单关通关率)：第1关92% 第2关82% 第3关65% 第4关40% 第5关22%
//   → 这样难度单调递减，全程通关率(0.92*0.82*0.65*0.4*0.22)≈4% 符合<5%
// 用法：./sim/run.sh tune.ts
import { GameWorld } from '../assets/scripts/core/world';
import { LEVEL_DEFS } from '../assets/scripts/core/levels';
import { makeLookaheadBot, SKILL_EXPERT } from './bots';

const DT = 1 / 60, MAX_SEC = 260, N = 40;
const TARGET = { 1: 92, 2: 82, 3: 65, 4: 40, 5: 22 };  // 高手单关通关率目标(%)

// 用临时威胁系数 ks[] 跑 N 局，返回各关"到达数/通过数"
function measure(ks: number[]) {
    const origs = LEVEL_DEFS.map(d => d.threat.map(t => ({ ...t })));
    LEVEL_DEFS.forEach((d, i) => d.threat = origs[i].map(t => ({ atSec: t.atSec, spawnRate: t.spawnRate * ks[i], hpMul: t.hpMul * ks[i] })));
    const reached = [0, 0, 0, 0, 0, 0], cleared = [0, 0, 0, 0, 0, 0];
    for (let seed = 1; seed <= N; seed++) {
        const w = new GameWorld(); w.start(1, seed * 7919 + 13);
        const bot = makeLookaheadBot(SKILL_EXPERT, seed * 7919 + 13); bot.reset?.();
        let reach = 1;
        for (let f = 0; f < MAX_SEC / DT && w.running; f++) {
            const ev = w.step(DT, { playerTargetX: bot.decide(w) });
            for (const e of ev) if (e.kind === 'level_start') reach = e.level;
        }
        const top = w.won ? 5 : reach;
        for (let lv = 1; lv <= top; lv++) reached[lv]++;
        for (let lv = 1; lv < top; lv++) cleared[lv]++;
        if (w.won) cleared[5]++;
    }
    LEVEL_DEFS.forEach((d, i) => d.threat = origs[i]);
    const rate = [0, 0, 0, 0, 0, 0];
    for (let lv = 1; lv <= 5; lv++) rate[lv] = reached[lv] > 0 ? cleared[lv] / reached[lv] * 100 : 0;
    return rate;
}

// 逐关二分：第lv关威胁系数 k，使该关高手通关率≈TARGET[lv]
// 注意：调第lv关要在前面关已定稿(玩家带正确能力进来)的前提下。链式从第1关调起。
const ks = [1, 1, 1, 1, 1];
console.log('===== 通关率驱动调参（逐关二分威胁系数）=====\n');
for (let lv = 1; lv <= 5; lv++) {
    let lo = 0.2, hi = 2.5, best = 1, bestErr = 999, bestRate = 0;
    for (let iter = 0; iter < 11; iter++) {
        const k = (lo + hi) / 2;
        const trial = ks.slice(); trial[lv - 1] = k;
        const rate = measure(trial)[lv];
        const err = Math.abs(rate - TARGET[lv as 1 | 2 | 3 | 4 | 5]);
        if (err < bestErr) { bestErr = err; best = k; bestRate = rate; }
        // 威胁高→通关率低。rate>目标→加威胁(k↑)；rate<目标→降威胁(k↓)
        if (rate > TARGET[lv as 1 | 2 | 3 | 4 | 5]) lo = k; else hi = k;
    }
    ks[lv - 1] = best;
    console.log(`第${lv}关: k=${best.toFixed(2)} → 高手通关率${bestRate.toFixed(0)}% (目标${TARGET[lv as 1 | 2 | 3 | 4 | 5]}%)`);
}
console.log('\n推荐 k:', JSON.stringify(ks.map(k => +k.toFixed(2))));
console.log('验证整体曲线:', measure(ks).slice(1).map(r => r.toFixed(0) + '%').join(' '));
