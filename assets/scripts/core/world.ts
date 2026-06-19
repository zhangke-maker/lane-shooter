// 无头游戏世界 —— 确定性纯逻辑核心，零 cc 依赖
// node 可直接跑（无头模拟），Cocos 渲染层每帧读它的快照来画
//
// 设计：world.step(dt, input) 推进一帧 → 返回本帧产生的事件
// 所有实体是 plain data，渲染层不拥有状态，只镜像
import {
    makeInitialState, computeDps,
    weaponStat, personLayout,
    GateType, EnemyType, ENEMY_BASE,
    LANE_LEFT_X, LANE_RIGHT_X, PLAYER_Y, PLAYER_MIN_X, PLAYER_MAX_X,
    SHOOT_INTERVAL, BULLET_SPEED, SCREEN_TOP, BASELINE_Y, ENEMY_SPAWN_JITTER,
} from './types';
import type { PlayerState, EnemyConfig } from './types';
import { LEVEL_DEFS, GATE_SEQUENCE, threatAt } from './levels';
import type { LevelDef } from './levels';

// PLAYER_MOVE_SPEED 不在 types 里（渲染相关），这里本地定义供模拟用
// （移动是逻辑也是手感，归核心）
// 纯视觉子弹（不参与伤害判定，伤害走"占领即全体输出"）。tx/ty = 飞向的目标点（某只怪/道具门），
// 让视觉与"全体输出"判定一致——看起来子弹确实飞到怪身上（自动弹幕，零瞄准）。
export interface Bullet { id: number; x: number; y: number; tx: number; ty: number; width: number; weak: boolean; }
export interface Enemy {
    id: number; x: number; y: number;
    cfg: EnemyConfig; hp: number; maxHp: number;
    isWaveBoss: boolean;   // 是否本关波次Boss（杀掉=通关，与类型无关——可能是 brute/mini_boss/boss）
}
export interface Gate {
    id: number; x: number; y: number;
    type: GateType; label: string;
    breakSecs: number;   // 满火力打穿需多少秒（固定，不随DPS变——修"越升级道具越快"的bug）
    progress: number;    // 已打进度 0~1（每帧 += dt/breakSecs，与DPS无关→打穿恒定 breakSecs 秒）
    slot: number;        // 0-3 传送带槽位（0 = 玩家正在打的活跃道具）
    targetY: number;     // 下移动画目标
}

// 槽位 Y（从下到上）
const SLOT_Y = [-160, 60, 280, 500];
const SLIDE_SPEED = 400;

// 世界事件（渲染/UI/音效消费）
export type WorldEvent =
    | { kind: 'enemy_killed'; cfg: EnemyConfig; x: number; y: number }
    | { kind: 'enemy_reached'; damage: number }
    | { kind: 'gate_cleared'; type: GateType; label: string }
    | { kind: 'weapon_up'; level: number }
    | { kind: 'person_up'; count: number }
    | { kind: 'player_hit'; hp: number; maxHp: number }
    | { kind: 'score'; score: number }
    | { kind: 'level_clear'; level: number }
    | { kind: 'level_start'; level: number }
    | { kind: 'game_over'; win: boolean };

export interface StepInput {
    playerTargetX: number;  // 玩家想去的 X（已由输入层钳制或这里钳制）
}

const PLAYER_MOVE_SPEED = 600;

// 移动火力损失（B 范式 = 走位+构筑决策型，非操作执行型）：
// 旧设计是"移动时子弹留在旧 x → 打空"（涌现的操作惩罚，触摸操作下太苛刻）。
// 新设计：移动时火力打折但【不归零】——移动是"双路时间取舍"的战术代价，不是"手抖"的操作惩罚。
// 子弹照常从当前 playerX 发射（不再靠打空），但伤害 ×MOVE_FIRE_PENALTY，并标记 weak 供渲染层外显。
// → 鼓励"短移动、到位就停打满火力"，技巧落在【何时去左路刷哪个道具】的决策，而非走位精度。
// 具体折扣值由 bot 通关率验证调，0.5 = 移动中半火力。
const MOVE_FIRE_PENALTY = 0.5;


// 怪海密度倍率：出怪量 ×N、单只血 ÷N（总威胁守恒——第一排总血量不变）。N 越大越"满屏怪海"。
// 36：怪数量适中(用户反馈 72 太密,减半)。总威胁守恒(数量÷2、单只血×2),难度不变、只是怪变少变厚。
// base.hp 已 ×100，÷N 后无取整失真，守恒成立。
const HORDE_DENSITY = 36;
const VISUAL_BULLET_CAP = 24;   // 每次发弹的最大子弹数(纯视觉)——人数无上限,封顶防超多人时子弹爆炸

// 「第一排」带宽（px）：右路火力只打最靠下这一带内的怪（约一个怪身高），逐排往上推平。
const FRONT_ROW_BAND = 80;

// 种子化伪随机（mulberry32）—— 确定性可复现，是通关率统计/无头模拟的前提。
// 禁用 Math.random（不可复现，且 node sim 环境也禁用）。
// 状态(_s)显式可读写，便于 clone() 快照 rng 位置（MCTS bot 前瞻模拟需要克隆世界）。
class Rng {
    _s: number;
    constructor(seed: number) { this._s = seed >>> 0; }
    next(): number {
        this._s = (this._s + 0x6D2B79F5) | 0;
        let t = Math.imul(this._s ^ (this._s >>> 15), 1 | this._s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

export class GameWorld {
    state: PlayerState = makeInitialState();
    playerX = 0;
    bullets: Bullet[] = [];
    enemies: Enemy[] = [];
    gates: Gate[] = [];

    levelTime = 0;          // 本关已过秒数（驱动威胁曲线出怪）
    running = false;
    gameOver = false;
    won = false;

    private _def: LevelDef | null = null;
    private _bossSpawned = false;
    private _shootTimer = 0;
    private _moving = false;        // 本帧玩家是否在移动（移动时火力打折，见 MOVE_FIRE_PENALTY）
    private _spawnAccum = 0;       // 出怪节流累加器（按 spawnRate 出怪）
    private _burstTimer = 0;       // 疏密波段计时
    private _burstMul = 1;         // 当前疏密倍率（形态随机）
    private _nextId = 1;
    private _pendingLevelStart = -1;  // >=0 表示在倒计时进入下一关
    private _levelStartDelay = 0;
    private _rng: Rng = new Rng(1);  // 种子化随机（威胁形态每局随机）

    // seed: 随机种子。同 seed 同输入 → 完全可复现（通关率统计要跑大量不同 seed）
    start(level = 1, seed = 1) {
        this._rng = new Rng(seed);
        this.state = makeInitialState();
        this.playerX = LANE_RIGHT_X;   // 开局停在右路：逼玩家先守怪(配合 L1 开局预置半屏怪),不能一上来就跑去刷道具
        this.bullets = []; this.enemies = []; this.gates = [];
        this.running = true; this.gameOver = false; this.won = false;
        this._beginLevel(level);
    }

    // 深拷贝整个世界（含 rng 位置）——供 MCTS bot 前瞻模拟"如果去左/去右会怎样"。
    // 克隆后两个世界独立推进，互不影响。
    clone(): GameWorld {
        const w = new GameWorld();
        w.state = { ...this.state };
        w.playerX = this.playerX;
        w.bullets = this.bullets.map(b => ({ ...b }));
        w.enemies = this.enemies.map(e => ({ ...e, cfg: { ...e.cfg } }));
        w.gates = this.gates.map(g => ({ ...g }));
        w.levelTime = this.levelTime;
        w.running = this.running; w.gameOver = this.gameOver; w.won = this.won;
        w._def = this._def;
        w._bossSpawned = this._bossSpawned;
        w._shootTimer = this._shootTimer;
        w._moving = this._moving;
        w._spawnAccum = this._spawnAccum;
        w._burstTimer = this._burstTimer;
        w._burstMul = this._burstMul;
        w._nextId = this._nextId;
        w._pendingLevelStart = this._pendingLevelStart;
        w._levelStartDelay = this._levelStartDelay;
        w._rng = new Rng(0); w._rng._s = this._rng._s;  // 复制 rng 当前位置
        return w;
    }

    private _beginLevel(level: number) {
        this.state.level = Math.min(level, LEVEL_DEFS.length);
        this._def = LEVEL_DEFS[this.state.level - 1];
        this.levelTime = 0;
        this._bossSpawned = false;
        this._spawnAccum = 0;
        this._burstTimer = 0;
        this._burstMul = 1;
        // 传送带跨关保留：只在首关(gates 为空)初始化 4 槽；过关时保留当前道具的当前进度，不重置
        // （否则"打了一半的道具"会过关后变满血新道具——已修的 bug）。
        if (this.gates.length === 0) {
            for (let i = 0; i < 4; i++) this._fillSlot(i);
        } else {
            // 跨关保留的门:breakSecs 刷新为新关值(否则残留门带着旧关耗时,破坏每关 gateSeconds 递增设计)。
            for (const g of this.gates) g.breakSecs = this._def!.gateSeconds[g.type];
        }
        // L1 开局预置怪：堵"开局跑去长时间刷道具"的投机——玩家一上来就得先守右路打怪。
        // y 从【半屏一直铺到屏顶】(midY→SCREEN_TOP)形成一条连续往下走的怪龙：第一波(半屏)清完时,
        // 上方的预置怪正好接着下来,无缝衔接到正常出怪流——消除"第一波清完到正常怪下来"的 5s 空窗(用户要"接上")。
        // 血量 ÷HORDE_DENSITY 与正常出怪一致(否则单只血 ×8 变厚,渲染按 maxHp 染红像高级怪——已修 bug)。
        if (this.state.level === 1 && this._def) {
            const hpMul0 = this._def.threat[0].hpMul / (this._def.hordeDensity ?? HORDE_DENSITY);
            const type = this._def.enemyPool[0];
            // 怪海从掉血线(BASELINE_Y)一直铺到屏顶 → 开局就铺满上方~2/3、压到主角小队头顶(对峙感)。
            const N = 40;
            for (let i = 0; i < N; i++) {
                const t = i / (N - 1);
                const y = BASELINE_Y + (SCREEN_TOP - BASELINE_Y) * t + (this._rng.next() - 0.5) * 40;
                this._spawnPreseed(type, hpMul0, y);
            }
        }
    }

    // 预置怪（开局已在场内某 y 位置，非从屏顶下来）。复用普通怪血量/横向铺满逻辑，仅 y 由参数指定。
    private _spawnPreseed(type: EnemyType, hpMul: number, y: number) {
        const base = ENEMY_BASE[type];
        const cfg: EnemyConfig = { ...base, hp: Math.max(1, Math.round(base.hp * hpMul)) };
        // 生成范围按怪视觉半宽(radius×1.55) inset 到红框[18,349]内，新怪一出来立绘就不越界。
        // 横向分布纯视觉，不参与占道命中判定(命中看 y/第一排)，不影响难度/bot。
        const visR = base.radius * 1.55;
        const lo = 18 + visR, hi = 349 - visR;
        this.enemies.push({
            id: this._nextId++,
            x: lo + this._rng.next() * Math.max(1, hi - lo),
            y,
            cfg, hp: cfg.hp, maxHp: cfg.hp, isWaveBoss: false,
        });
    }

    // ---- 主步进 ----
    step(dt: number, input: StepInput): WorldEvent[] {
        const ev: WorldEvent[] = [];
        if (!this.running || this.gameOver) return ev;

        // 关卡过渡倒计时
        if (this._pendingLevelStart >= 0) {
            this._levelStartDelay -= dt;
            if (this._levelStartDelay <= 0) {
                const lv = this._pendingLevelStart;
                this._pendingLevelStart = -1;
                this._beginLevel(lv);
                ev.push({ kind: 'level_start', level: lv });
            }
            return ev;  // 过渡期间不推进世界
        }

        this.levelTime += dt;

        this._movePlayer(dt, input.playerTargetX);
        this._spawnByThreat(dt);
        this._maybeSpawnBoss();
        this._spawnVisualTracers(dt);   // 纯视觉子弹（手感），不参与伤害
        this._moveBullets(dt);
        this._applyFire(dt, ev);        // 占领某路=对该路全体输出（命中模型）
        this._moveEnemies(dt, ev);
        this._slideGates(dt);

        return ev;
    }

    private _movePlayer(dt: number, targetX: number) {
        const tx = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, targetX));
        const dx = tx - this.playerX;
        const step = PLAYER_MOVE_SPEED * dt;
        // 是否实际发生位移（已到位/原地不动 = 不算移动 = 满火力）
        this._moving = Math.abs(dx) >= step;
        this.playerX = Math.abs(dx) < step ? tx : this.playerX + Math.sign(dx) * step;
    }

    // 命中模型：「占领某路 = 对该路全体输出」（零瞄准，认知门槛最低，B 范式极致）。
    // 不再用子弹物理碰撞——玩家站哪条路，总 DPS 就施加到那条路的目标上：
    //   右路 → 总 DPS 平摊给右路所有怪（怪海越密单只越难死 = 整体压迫感，类 VS 光环）
    //   左路 → 总 DPS 打活跃道具门（slot0）
    // 移动中火力打折不归零（B 范式战术代价）。子弹只剩纯视觉（renderer 自行画飞行子弹做手感）。
    private _applyFire(dt: number, ev: WorldEvent[]) {
        const firePower = this._moving ? MOVE_FIRE_PENALTY : 1;   // 移动时半火力（B范式）
        if (this.playerX < 0) this._fireLeft(dt * firePower, ev);
        else this._fireRight(computeDps(this.state) * firePower * dt, ev);
    }

    // 右路：总伤害只平摊给「第一排」（最靠下的一带怪），不是全屏平摊。
    // 全屏平摊会让所有怪血量同步下降→"集体暴毙"（反直觉）；只打第一排 → 一排一排往上推平，
    // 有"逐排击破"的清晰过程 + 怪海后排仍铺满（视觉压迫不变）。先打最靠下的也合理（先清要扣血的）。
    private _fireRight(totalDmg: number, ev: WorldEvent[]) {
        if (this.enemies.length === 0) return;
        // 第一排 = 最靠下的怪 + 其上 FRONT_ROW_BAND 内的怪（一带宽度，而非固定只数）
        let minY = Infinity;
        for (const e of this.enemies) if (e.y < minY) minY = e.y;
        const front = this.enemies.filter(e => e.y <= minY + FRONT_ROW_BAND);
        const per = totalDmg / front.length;
        const dead = new Set<number>();
        for (const e of front) {
            e.hp -= per;
            if (e.hp <= 0) { dead.add(e.id); this._onEnemyKilled(e, ev); }
        }
        // 单次批量移除（怪海下避免每杀一只 filter 一次的 O(K·N)）
        if (dead.size) this.enemies = this.enemies.filter(e => !dead.has(e.id));
    }

    // 左路：按【时间】推进活跃道具门进度（打穿恒定 breakSecs 秒，与DPS无关）。
    // effSec = 本帧有效火力时长（站定=dt，移动=dt×0.5）。修"越升级道具越快"的 bug。
    private _fireLeft(effSec: number, ev: WorldEvent[]) {
        const g = this.gates.find(gg => gg.slot === 0);
        if (!g) return;
        g.progress += effSec / g.breakSecs;
        if (g.progress >= 1) this._clearGate(g, ev);
    }

    // 纯视觉子弹（射击手感）——每发飞向"占领那条路的一个目标"（右路某只怪 / 左路道具门），
    // 让视觉与"占领即全体输出"判定一致（自动弹幕，看起来确实打在怪身上，零瞄准）。
    private _spawnVisualTracers(dt: number) {
        this._shootTimer -= dt;
        if (this._shootTimer > 0) return;
        this._shootTimer = SHOOT_INTERVAL;
        // 目标池：右路时只打"第一排"（与 _fireRight 一致，子弹飞向正在掉血的那批怪），左路时是活跃道具门
        const onLeft = this.playerX < 0;
        let targets: { x: number; y: number }[];
        if (onLeft) {
            targets = this.gates.filter(g => g.slot === 0).map(g => ({ x: g.x, y: g.y }));
        } else {
            let minY = Infinity;
            for (const e of this.enemies) if (e.y < minY) minY = e.y;
            targets = this.enemies.filter(e => e.y <= minY + FRONT_ROW_BAND).map(e => ({ x: e.x, y: e.y }));
        }
        if (targets.length === 0) return;   // 没目标不发弹（没在对着空气打）
        const stat = weaponStat(this.state.weaponLevel);
        // 弹道发射点用 personLayout(与渲染小人同源,避免错位)。人数无上限,但发弹数封顶 VISUAL_BULLET_CAP
        // 防超多人时每帧子弹爆炸(纯视觉,不影响伤害——伤害是"占领即全体输出"模型)。
        const layout = personLayout(this.state.personCount);
        const n = Math.min(layout.length, VISUAL_BULLET_CAP);
        for (let i = 0; i < n; i++) {
            const off = layout[i];
            // 每个小人随机分一个目标（弹幕铺开飞向不同怪）
            const t = targets[Math.floor(this._rng.next() * targets.length)];
            this.bullets.push({
                id: this._nextId++,
                x: this.playerX + off.dx,
                y: PLAYER_Y + off.dy + 40,
                tx: t.x, ty: t.y, width: stat.bulletWidth,
                weak: this._moving,   // 移动中视觉弱化（juice）
            });
        }
    }

    // 威胁曲线驱动潮水出怪。难度上限固定（spawnRate/hpMul 的曲线=每关设计好的递增上限），
    // 但形态每局随机：① 出怪时机随机抖动（同均值→同总量，但疏密成团每局不同，防背谱）
    // ② 怪种类随机 ③ 出怪 X 随机。Boss 出现后潮水继续（边守边打）。
    private _spawnByThreat(dt: number) {
        if (!this._def) return;
        const { spawnRate, hpMul } = threatAt(this._def, this.levelTime);
        // 形态随机：每隔一小段(_burstTimer)重掷一次"疏密倍率"，制造成团的密集/稀疏波段
        // 倍率在 [0.35,1.65] 均值≈1，长期总量守恒（难度上限不变，只动形态）
        this._burstTimer -= dt;
        if (this._burstTimer <= 0) {
            this._burstMul = 0.35 + this._rng.next() * 1.3;
            this._burstTimer = 1.0 + this._rng.next() * 1.5;  // 每 1~2.5s 换一次波段
        }
        // 怪海密度：出怪量 ×density 造"满屏怪海"，同时单只血量 ÷density，使总威胁基本守恒。
        // 每关可覆盖(L1 怪极脆用 8 避开血量地板,其他关默认 24 填满右路)。
        const density = this._def.hordeDensity ?? HORDE_DENSITY;
        this._spawnAccum += spawnRate * density * this._burstMul * dt;
        while (this._spawnAccum >= 1) {
            this._spawnAccum -= 1;
            const pool = this._def.enemyPool;
            const type = pool[Math.floor(this._rng.next() * pool.length)];  // 随机怪种
            this._spawnPoolEnemy(type, hpMul / density);
        }
    }

    // Boss 在 durationSec 出现（杀掉=通关）
    private _maybeSpawnBoss() {
        if (!this._def || this._bossSpawned) return;
        if (this.levelTime >= this._def.durationSec) {
            this._spawnBoss(this._def.bossType, this._def.bossHp);
            this._bossSpawned = true;
        }
    }

    // 潮水普通怪：血量 = base.hp × 固定威胁曲线 hpMul（**不挂玩家DPS**，固定时间线）。
    // 怪自顾自按设计曲线变强，玩家必须靠升级追上它——逼"必须在某节点刷到道具"，否则裸装扛不住。
    // 潮水普通怪从屏顶出现。与预置怪唯一差别是 y(屏顶 vs 半屏),故复用 _spawnPreseed。
    private _spawnPoolEnemy(type: EnemyType, hpMul: number) {
        // 横向铺满右路 [≈20,190] 由 _spawnPreseed 统一处理；y = 屏顶(怪半径+边距)
        this._spawnPreseed(type, hpMul, SCREEN_TOP + ENEMY_BASE[type].radius + 10);
    }

    private _spawnBoss(type: EnemyType, hp: number) {
        const base = ENEMY_BASE[type];
        const cfg: EnemyConfig = { ...base, hp };
        this.enemies.push({
            id: this._nextId++,
            x: LANE_RIGHT_X,   // Boss 居中右路
            y: SCREEN_TOP + cfg.radius + 10,
            cfg, hp, maxHp: hp, isWaveBoss: true,
        });
    }

    // 视觉子弹飞向目标点（自动弹幕），到达即消失（命中特效由渲染层做）
    private _moveBullets(dt: number) {
        const step = BULLET_SPEED * dt;
        const survivors: Bullet[] = [];
        for (const b of this.bullets) {
            const dx = b.tx - b.x, dy = b.ty - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= step) continue;   // 到达目标，消失
            b.x += dx / dist * step;
            b.y += dy / dist * step;
            survivors.push(b);
        }
        this.bullets = survivors;
    }

    private _moveEnemies(dt: number, ev: WorldEvent[]) {
        this._separateEnemies(dt);   // 横向分离(防穿模，纯视觉，不动 y/命中)
        const survivors: Enemy[] = [];
        let bossLeaked = false;
        for (const e of this.enemies) {
            e.y -= e.cfg.speed * dt;
            if (e.y < BASELINE_Y) {
                if (e.isWaveBoss) {
                    // Boss 漏到底线：吃掉【最大血量的 80%】(固定值,如 maxHp100→扣80) + 直接算过关
                    // (Boss 没被打死也通关,避免卡关)。残血时被扣 80 可能直接死→game over。
                    this._damagePlayer(this.state.maxHp * 0.8, ev);
                    ev.push({ kind: 'enemy_reached', damage: e.cfg.damage });
                    bossLeaked = true;   // 本帧结束后触发过关(先把剩余怪处理完)
                } else {
                    this._damagePlayer(e.cfg.damage, ev);
                    ev.push({ kind: 'enemy_reached', damage: e.cfg.damage });
                }
            } else {
                survivors.push(e);
            }
        }
        this.enemies = survivors;
        // Boss 漏掉过关：放在循环后,且仅当玩家没被 80% 扣血扣死时才算过关(死了就是 game over)。
        if (bossLeaked && this.running && !this.gameOver) this._onLevelComplete(ev);
    }

    // 横向分离(防穿模)：简化 Reynolds separation——只保留 separation(无 alignment/cohesion)、
    // 只调 x(纯横向、不动 y/命中)、O(n²) 朴素遍历(怪量级几十~百足够,无需 spatial grid)。
    // 确定性函数(只依赖怪位置,无随机)→ 不破坏 replay；e.x 不参与占道命中→ 不影响难度/bot。
    // 允许适度重叠、只防完全堆叠(业界共识:Vampire Survivors 等也允许部分重叠)。
    private _separateEnemies(dt: number) {
        const n = this.enemies.length;
        if (n < 2) return;
        const PUSH = 140;          // 推力强度(px/s)，大怪需更大位移才分得开
        // 粗夹在右路逻辑范围 world x∈[18,349]，防怪飘太远；精确视觉边界由 render 层按真实显示宽 clamp(单一真相源)。
        const LANE_L = 18, LANE_R = 349;
        // 分离间距按视觉半径算(radius×1.55)，匹配渲染放大，避免大怪因绝对尺寸大而仍重叠。
        const visR = (e) => e.cfg.radius * 1.55;
        for (let i = 0; i < n; i++) {
            const a = this.enemies[i];
            const ra = visR(a);
            let dx = 0;
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const b = this.enemies[j];
                const want = (ra + visR(b)) * 0.85;   // 期望间距=两怪视觉半径和(0.85 允许轻微重叠，业界共识)
                if (Math.abs(b.y - a.y) > want) continue;   // y 差超过期望间距=非邻居(剪枝)
                const d = a.x - b.x;
                const ad = Math.abs(d);
                if (ad < want && ad > 0.001) dx += (d / ad) * (want - ad);   // 越近推越狠(类 1/r)
                else if (ad <= 0.001) dx += (i < j ? 1 : -1) * want;          // 完全重合:按序错开
            }
            a.x += Math.max(-PUSH * dt, Math.min(PUSH * dt, dx * dt));        // 限幅,平滑
            // 粗夹在右路逻辑范围(精确边界由 render 层按真实显示宽 clamp，单一真相源)
            if (a.x < LANE_L) a.x = LANE_L; else if (a.x > LANE_R) a.x = LANE_R;
        }
    }

    private _slideGates(dt: number) {
        for (const g of this.gates) {
            if (g.y === g.targetY) continue;
            const dy = g.targetY - g.y;
            const step = Math.sign(dy) * SLIDE_SPEED * dt;
            g.y = Math.abs(dy) < Math.abs(step) ? g.targetY : g.y + step;
        }
    }

    // ---- 怪死亡 ----
    // 处理一只怪死亡的【副作用】（计分/事件/通关），不负责从数组移除——移除由调用方批量做。
    private _onEnemyKilled(e: Enemy, ev: WorldEvent[]) {
        this.state.score += e.cfg.scoreValue;
        ev.push({ kind: 'enemy_killed', cfg: e.cfg, x: e.x, y: e.y });   // 带死亡真实坐标→特效画在兵线处(随DPS前后移)
        ev.push({ kind: 'score', score: this.state.score });

        // 杀掉波次Boss（时间轴最后一个怪）→ 通关本关。与怪类型无关，避免漏判 brute 类波次Boss
        if (e.isWaveBoss) this._onLevelComplete(ev);
    }

    private _onLevelComplete(ev: WorldEvent[]) {
        ev.push({ kind: 'level_clear', level: this.state.level });
        const next = this.state.level + 1;
        if (next > LEVEL_DEFS.length) {
            this.running = false; this.gameOver = true; this.won = true;
            ev.push({ kind: 'game_over', win: true });
        } else {
            this._pendingLevelStart = next;
            this._levelStartDelay = 2.0;  // 2秒过渡
        }
    }

    // ---- 道具门 ----
    private _fillSlot(slot: number) {
        const cfg = this._nextGateConfig();
        this.gates.push({
            id: this._nextId++, x: LANE_LEFT_X, y: SLOT_Y[slot], targetY: SLOT_Y[slot],
            type: cfg.type, label: cfg.label,
            breakSecs: this._def!.gateSeconds[cfg.type], progress: 0,
            slot,
        });
    }

    // 道具随机抽取（形态随机：每局道具顺序不同，玩家不能背"槽0永远是武器"）。
    // 升级无上限：武器/加人都无限×2,道具门永远有效(消除旧"满级出+0无效门"的 bug)。
    // label 仅占位；加人门实际显示由渲染层按实时 personCount 动态算(绕开提前生成锁定旧人数的时机 bug)。
    private _nextGateConfig(): { type: GateType; label: string } {
        return GATE_SEQUENCE[Math.floor(this._rng.next() * GATE_SEQUENCE.length)];
    }

    private _clearGate(g: Gate, ev: WorldEvent[]) {
        // 应用效果（只有攻击道具：武器升级 / 加人）
        switch (g.type) {
            case GateType.WEAPON_UP:
                this.state.weaponLevel++;   // 武器无上限：每次伤害 ×2(2^level)
                ev.push({ kind: 'weapon_up', level: this.state.weaponLevel });
                break;
            case GateType.PERSON_UP:
                this.state.personCount *= 2;   // 加人无上限：每次 ×2(1→2→4→8→16→32→64…)
                ev.push({ kind: 'person_up', count: this.state.personCount });
                break;
        }
        ev.push({ kind: 'gate_cleared', type: g.type, label: g.label });

        this.gates = this.gates.filter(x => x.id !== g.id);

        // 传送带下移 + 顶部补入
        for (const other of this.gates) {
            if (other.slot > g.slot) { other.slot--; other.targetY = SLOT_Y[other.slot]; }
        }
        this._fillSlotTop();
    }

    private _fillSlotTop() {
        const cfg = this._nextGateConfig();
        this.gates.push({
            id: this._nextId++, x: LANE_LEFT_X, y: SCREEN_TOP + 80, targetY: SLOT_Y[3],
            type: cfg.type, label: cfg.label,
            breakSecs: this._def!.gateSeconds[cfg.type], progress: 0,
            slot: 3,
        });
    }

    // ---- 玩家数值 ----
    private _damagePlayer(amount: number, ev: WorldEvent[]) {
        this.state.hp = Math.max(0, this.state.hp - amount);
        ev.push({ kind: 'player_hit', hp: this.state.hp, maxHp: this.state.maxHp });
        if (this.state.hp <= 0) {
            this.running = false; this.gameOver = true; this.won = false;
            ev.push({ kind: 'game_over', win: false });
        }
    }

    // 渲染层用：玩家本帧是否在移动（外显"移动损失火力"）
    get isMoving(): boolean { return this._moving; }
}
