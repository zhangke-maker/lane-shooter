// 回放：跑前瞻 bot 一条命，逐秒文字时间线，验证 bot 行为是否像真人
// 用法：./sim/run.sh replay.ts [seed]
import { GameWorld } from '../assets/scripts/core/world';
import { weaponName } from '../assets/scripts/core/types';
import { makeStrategyBot, SKILL_EXPERT } from './bots';

const seed = parseInt(process.argv[2] || '1', 10);
const w = new GameWorld(); w.start(1, seed);
const bot = makeStrategyBot(SKILL_EXPERT); bot.reset?.();
const dt = 1 / 60;
let t = 0, curLv = 1, lastLane = '', leftFrames = 0, total = 0, switches = 0;

function bar(hp: number) { const n = Math.round(hp / 5); return '█'.repeat(Math.max(0, n)) + '░'.repeat(Math.max(0, 20 - n)); }
function log(note: string) {
    const lane = w.playerX < -50 ? '左🔧' : '右⚔️';
    console.log(`${t.toFixed(1).padStart(5)} | ${lane} | ${bar(w.state.hp)} ${String(Math.ceil(w.state.hp)).padStart(3)} | ${weaponName(w.state.weaponLevel).padEnd(3)}×${w.state.personCount} | ${note}`);
}

console.log(`=== 前瞻 bot 回放 (seed=${seed}, EXPERT) ===`);
console.log(`时刻 | 位 | HP                     | 武器 人 | 事件`);
for (let f = 0; f < 220 / dt && w.running; f++) {
    const ev = w.step(dt, { playerTargetX: bot.decide(w) });
    t += dt; total++;
    if (w.playerX < -50) leftFrames++;
    const lane = w.playerX < -50 ? 'L' : 'R';
    if (lane !== lastLane) { if (lastLane) switches++; lastLane = lane; }
    for (const e of ev) {
        if (e.kind === 'weapon_up') log(`✦武器→${weaponName(e.level)}`);
        else if (e.kind === 'person_up') log(`✦加人→${e.count}`);
        else if (e.kind === 'level_clear') log(`🎉第${e.level}关通关`);
        else if (e.kind === 'level_start') { curLv = e.level; }
        else if (e.kind === 'game_over') log(e.win ? '🏆全通关' : '💀阵亡');
    }
}
console.log(`\n结果: ${w.won ? '通关全5关' : '死在第' + curLv + '关'}  剩HP=${Math.ceil(w.state.hp)}`);
console.log(`左路时间占比=${(leftFrames / total * 100).toFixed(0)}%（应<50%=主力打怪）  泳道切换=${switches}次（过多=横跳）`);
