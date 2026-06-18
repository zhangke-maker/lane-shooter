// 精确重放真人录像 + 逐秒分析真实策略。
// 用法：./sim/run.sh replay-human.ts <录像文件路径>
// 录像 = 网页 game-over 自动下载的 lane-rec-<seed>.json：{seed, inputs:[每帧playerTargetX]}
import { readFileSync } from 'node:fs';
import { GameWorld } from '../assets/scripts/core/world';
import { computeDps, BASELINE_Y, weaponName } from '../assets/scripts/core/types';

const path = process.argv[2];
if (!path) { console.error('用法: ./sim/run.sh replay-human.ts <录像json>'); process.exit(1); }
const rec = JSON.parse(readFileSync(path, 'utf8')) as { seed: number; inputs: number[] };

const w = new GameWorld(); w.start(1, rec.seed);
const dt = 1 / 60;
let leftFrames = 0, lvLeft = 0, lvTot = 0, lastLv = 1;
let secLeft = 0, secTot = 0;   // 本秒左路帧/总帧
let leakThisSec = 0;

console.log(`=== 真人录像分析 (seed=${rec.seed}, ${rec.inputs.length}帧≈${(rec.inputs.length/60).toFixed(0)}秒) ===`);
console.log('秒 | 关 | 位置(左刷%) | HP | 武器×人(DPS) | 同屏怪 | 第一排怪海 | 本秒漏怪');

for (let f = 0; f < rec.inputs.length && w.running; f++) {
    const tx = rec.inputs[f];
    const onLeft = w.playerX < 0;
    if (onLeft) { leftFrames++; lvLeft++; secLeft++; }
    lvTot++; secTot++;
    const ev = w.step(dt, { playerTargetX: tx });
    for (const e of ev) {
        if (e.kind === 'level_start') { lvLeft = 0; lvTot = 0; lastLv = e.level; }
        if (e.kind === 'enemy_reached') leakThisSec++;
    }
    // 每秒打印一行
    if (f % 60 === 59) {
        const dps = computeDps(w.state);
        // 第一排怪海总血（最靠下一带）
        let fy = Infinity; for (const e of w.enemies) if (e.y < fy) fy = e.y;
        let frontHp = 0; for (const e of w.enemies) if (e.y <= fy + 80) frontHp += e.hp;
        console.log(
            `${String(Math.round((f + 1) / 60)).padStart(2)} | ${lastLv} | ` +
            `${(secLeft / secTot * 100).toFixed(0).padStart(3)}% | ${w.state.hp.toFixed(0).padStart(3)} | ` +
            `${weaponName(w.state.weaponLevel)}×${w.state.personCount}(${dps.toFixed(0)}) | ` +
            `${String(w.enemies.length).padStart(2)} | ${frontHp.toFixed(0).padStart(4)}血 | ${leakThisSec}`
        );
        secLeft = 0; secTot = 0; leakThisSec = 0;
    }
}
console.log(`\n结局: ${w.won ? '通关全5关' : '死在第' + w.state.level + '关'} HP=${w.state.hp.toFixed(0)} 武器${weaponName(w.state.weaponLevel)}×${w.state.personCount}`);
console.log(`全程左路占比=${(leftFrames / rec.inputs.length * 100).toFixed(0)}%`);
console.log('→ 看你的真实策略：何时去左路刷(左刷%高的秒)、怪海堆多少、漏怪多不多、DPS怎么滚');
