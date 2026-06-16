// 无头游戏世界 —— 确定性纯逻辑核心，零 cc 依赖
// node 可直接跑（无头模拟），Cocos 渲染层每帧读它的快照来画
//
// 设计：world.step(dt, input) 推进一帧 → 返回本帧产生的事件
// 所有实体是 plain data，渲染层不拥有状态，只镜像
import {
    makeInitialState, computeDps,
    WEAPON_STATS, WeaponLevel, MAX_WEAPON_LEVEL, MAX_PERSON, PERSON_OFFSETS,
    GateType, EnemyType, ENEMY_BASE,
    LANE_LEFT_X, LANE_RIGHT_X, PLAYER_Y, PLAYER_MIN_X, PLAYER_MAX_X,
    SHOOT_INTERVAL, BULLET_SPEED, SCREEN_TOP, BASELINE_Y, ENEMY_SPAWN_JITTER,
} from './types';
import type { PlayerState, EnemyConfig } from './types';
import { LEVEL_DEFS, GATE_SEQUENCE, threatAt } from './levels';
import type { LevelDef } from './levels';

// PLAYER_MOVE_SPEED 不在 types 里（渲染相关），这里本地定义供模拟用
// （移动是逻辑也是手感，归核心）
export interface Bullet { id: number; x: number; y: number; damage: number; width: number; weak: boolean; }
export interface Enemy {
    id: number; x: number; y: number;
    cfg: EnemyConfig; hp: number; maxHp: number;
    isWaveBoss: boolean;   // 是否本关波次Boss（杀掉=通关，与类型无关——可能是 brute/mini_boss/boss）
}
export interface Gate {
    id: number; x: number; y: number;
    type: GateType; hp: number; maxHp: number; label: string; healAmount?: number;
    slot: number;        // 0-3 传送带槽位；-1 = 右路自由掉落（Boss补血）
    targetY: number;     // 下移动画目标
    freeDrop: boolean;
}

// 槽位 Y（从下到上）
const SLOT_Y = [-160, 60, 280, 500];
const SLIDE_SPEED = 400;
const GATE_HIT_W = 140, GATE_HIT_H = 60;

// 世界事件（渲染/UI/音效消费）
export type WorldEvent =
    | { kind: 'enemy_killed'; cfg: EnemyConfig }
    | { kind: 'enemy_reached'; damage: number }
    | { kind: 'gate_cleared'; type: GateType; label: string }
    | { kind: 'weapon_up'; level: number }
    | { kind: 'person_up'; count: number }
    | { kind: 'heal'; amount: number }
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

// 抗成长通胀：怪血随玩家当前 DPS 部分追赶（治"先难后平趟"，用户拍板 A 方案）。
// 玩家 DPS 指数涨(~200×)，纯按时间的固定威胁会被碾平→后关净回血。让怪血挂 DPS：
//   chase = (curDps / BASE_DPS) ^ CHASE_EXP，curDps 越高怪越硬，玩家仍掉血。
// BASE_DPS = 初始手枪×1 的 DPS（此基线下 chase=1，不影响前期）；
// CHASE_EXP<1 让追赶【次线性】——升级仍有净收益(不抵消投资=保升级爽感)，但不再平趟。
const CHASE_BASE_DPS = 8.33;   // 手枪×1 = 1×1×(1/0.12)
const CHASE_EXP = 0.72;        // 次线性指数，bot 验证调

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
        this.playerX = 0;
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
        // 初始化传送带 4 槽
        this.gates = [];
        for (let i = 0; i < 4; i++) this._fillSlot(i);
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
        this._shoot(dt);
        this._spawnByThreat(dt);
        this._maybeSpawnBoss();
        this._moveBullets(dt);
        this._moveEnemies(dt, ev);
        this._slideGates(dt);
        this._collide(ev);

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

    private _shoot(dt: number) {
        this._shootTimer -= dt;
        if (this._shootTimer > 0) return;
        this._shootTimer = SHOOT_INTERVAL;
        const stat = WEAPON_STATS[this.state.weaponLevel];
        const n = Math.min(this.state.personCount, PERSON_OFFSETS.length);
        // 移动中火力打折但不归零（B 范式战术代价，见 MOVE_FIRE_PENALTY）
        const dmg = this._moving ? stat.damage * MOVE_FIRE_PENALTY : stat.damage;
        for (let i = 0; i < n; i++) {
            const off = PERSON_OFFSETS[i];
            this.bullets.push({
                id: this._nextId++,
                x: this.playerX + off[0],
                y: PLAYER_Y + off[1] + 40,
                damage: dmg, width: stat.bulletWidth,
                weak: this._moving,   // 渲染层据此外显"移动中火力减弱"（juice）
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
        this._spawnAccum += spawnRate * this._burstMul * dt;
        while (this._spawnAccum >= 1) {
            this._spawnAccum -= 1;
            const pool = this._def.enemyPool;
            const type = pool[Math.floor(this._rng.next() * pool.length)];  // 随机怪种
            this._spawnPoolEnemy(type, hpMul);
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

    // 抗成长通胀系数：怪血随玩家当前 DPS 次线性追赶（≥1）。详见 CHASE_* 常量。
    private _dpsChase(): number {
        const dps = computeDps(this.state);
        return Math.max(1, Math.pow(dps / CHASE_BASE_DPS, CHASE_EXP));
    }

    // 潮水普通怪：血量 = 固定曲线 hpMul × 抗成长通胀的 DPS 追赶系数。
    private _spawnPoolEnemy(type: EnemyType, hpMul: number) {
        const base = ENEMY_BASE[type];
        const cfg: EnemyConfig = {
            ...base,
            hp: Math.max(1, Math.round(base.hp * hpMul * this._dpsChase())),
        };
        this.enemies.push({
            id: this._nextId++,
            x: LANE_RIGHT_X - this._rng.next() * ENEMY_SPAWN_JITTER,  // 随机出怪 X（可达范围内）
            y: SCREEN_TOP + cfg.radius + 10,
            cfg, hp: cfg.hp, maxHp: cfg.hp, isWaveBoss: false,
        });
    }

    private _spawnBoss(type: EnemyType, hp: number) {
        const base = ENEMY_BASE[type];
        const cfg: EnemyConfig = { ...base, hp };
        this.enemies.push({
            id: this._nextId++,
            x: LANE_RIGHT_X - 0.5 * ENEMY_SPAWN_JITTER,
            y: SCREEN_TOP + cfg.radius + 10,
            cfg, hp, maxHp: hp, isWaveBoss: true,
        });
    }

    private _moveBullets(dt: number) {
        for (const b of this.bullets) b.y += BULLET_SPEED * dt;
        this.bullets = this.bullets.filter(b => b.y <= SCREEN_TOP);
    }

    private _moveEnemies(dt: number, ev: WorldEvent[]) {
        const survivors: Enemy[] = [];
        for (const e of this.enemies) {
            e.y -= e.cfg.speed * dt;
            if (e.y < BASELINE_Y) {
                this._damagePlayer(e.cfg.damage, ev);
                ev.push({ kind: 'enemy_reached', damage: e.cfg.damage });
            } else {
                survivors.push(e);
            }
        }
        this.enemies = survivors;
    }

    private _slideGates(dt: number) {
        for (const g of this.gates) {
            if (g.y === g.targetY) continue;
            const dy = g.targetY - g.y;
            const step = Math.sign(dy) * SLIDE_SPEED * dt;
            g.y = Math.abs(dy) < Math.abs(step) ? g.targetY : g.y + step;
        }
    }

    // ---- 碰撞 ----
    private _collide(ev: WorldEvent[]) {
        const deadBullets = new Set<number>();
        for (const b of this.bullets) {
            if (deadBullets.has(b.id)) continue;
            const isLeft = b.x < 0;
            if (isLeft) {
                if (this._bulletVsGate(b, ev)) deadBullets.add(b.id);
            } else {
                if (this._bulletVsEnemy(b, ev)) { deadBullets.add(b.id); continue; }
                if (this._bulletVsGate(b, ev)) deadBullets.add(b.id);  // 右路自由掉落补血
            }
        }
        if (deadBullets.size) this.bullets = this.bullets.filter(b => !deadBullets.has(b.id));
    }

    private _bulletVsEnemy(b: Bullet, ev: WorldEvent[]): boolean {
        for (const e of this.enemies) {
            const dx = b.x - e.x, dy = b.y - e.y;
            const r = e.cfg.radius + b.width * 0.5;
            if (dx * dx + dy * dy < r * r) {
                e.hp -= b.damage;
                if (e.hp <= 0) this._killEnemy(e, ev);
                return true;
            }
        }
        return false;
    }

    private _bulletVsGate(b: Bullet, ev: WorldEvent[]): boolean {
        for (const g of this.gates) {
            if (!this._gateHittable(g)) continue;
            if (Math.abs(b.x - g.x) < GATE_HIT_W / 2 && Math.abs(b.y - g.y) < GATE_HIT_H / 2) {
                g.hp -= b.damage;
                if (g.hp <= 0) this._clearGate(g, ev);
                return true;
            }
        }
        return false;
    }

    private _gateHittable(g: Gate): boolean {
        return g.slot === 0 || g.freeDrop;
    }

    // ---- 怪死亡 ----
    private _killEnemy(e: Enemy, ev: WorldEvent[]) {
        this.enemies = this.enemies.filter(x => x.id !== e.id);
        this.state.score += e.cfg.scoreValue;
        ev.push({ kind: 'enemy_killed', cfg: e.cfg });
        ev.push({ kind: 'score', score: this.state.score });
        if (e.cfg.healDrop) this._spawnHealDrop(e.x, e.y);

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
        const hp = this._gateHp(cfg.type);
        this.gates.push({
            id: this._nextId++, x: LANE_LEFT_X, y: SLOT_Y[slot], targetY: SLOT_Y[slot],
            type: cfg.type, hp, maxHp: hp, label: cfg.label, healAmount: cfg.healAmount,
            slot, freeDrop: false,
        });
    }

    // 道具随机抽取（形态随机：每局道具顺序不同，玩家不能背"槽0永远是武器"）。
    // 从序列里随机挑一个未满级的类型；用序列的类型构成做加权（保持武器/人/血的大致比例）。
    private _nextGateConfig() {
        const usable = GATE_SEQUENCE.filter(t => {
            if (t.type === GateType.WEAPON_UP && this.state.weaponLevel >= MAX_WEAPON_LEVEL) return false;
            if (t.type === GateType.PERSON_UP && this.state.personCount >= MAX_PERSON) return false;
            return true;
        });
        if (usable.length === 0) return { type: GateType.HEAL, label: '+30 血', healAmount: 30 };
        return usable[Math.floor(this._rng.next() * usable.length)];
    }

    private _gateHp(type: GateType): number {
        const dps = computeDps(this.state);
        const secs = this._def!.gateSeconds[type];
        const floor = type === GateType.WEAPON_UP ? 10 : type === GateType.PERSON_UP ? 8 : 5;
        return Math.max(floor, Math.round(dps * secs));
    }

    private _clearGate(g: Gate, ev: WorldEvent[]) {
        // 应用效果
        switch (g.type) {
            case GateType.WEAPON_UP:
                if (this.state.weaponLevel < MAX_WEAPON_LEVEL) this.state.weaponLevel++;
                ev.push({ kind: 'weapon_up', level: this.state.weaponLevel });
                break;
            case GateType.PERSON_UP:
                if (this.state.personCount < MAX_PERSON) this.state.personCount++;
                ev.push({ kind: 'person_up', count: this.state.personCount });
                break;
            case GateType.HEAL:
                this._heal(g.healAmount ?? 30, ev);
                break;
        }
        ev.push({ kind: 'gate_cleared', type: g.type, label: g.label });

        this.gates = this.gates.filter(x => x.id !== g.id);
        if (g.freeDrop) return;  // 自由掉落不走传送带

        // 传送带下移 + 顶部补入
        for (const other of this.gates) {
            if (other.freeDrop) continue;
            if (other.slot > g.slot) { other.slot--; other.targetY = SLOT_Y[other.slot]; }
        }
        this._fillSlotTop();
    }

    private _fillSlotTop() {
        const cfg = this._nextGateConfig();
        const hp = this._gateHp(cfg.type);
        this.gates.push({
            id: this._nextId++, x: LANE_LEFT_X, y: SCREEN_TOP + 80, targetY: SLOT_Y[3],
            type: cfg.type, hp, maxHp: hp, label: cfg.label, healAmount: cfg.healAmount,
            slot: 3, freeDrop: false,
        });
    }

    private _spawnHealDrop(x: number, y: number) {
        this.gates.push({
            id: this._nextId++, x: Math.max(0, x), y, targetY: y,
            type: GateType.HEAL, hp: 1, maxHp: 1, label: '+50 血', healAmount: 50,
            slot: -1, freeDrop: true,
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

    private _heal(amount: number, ev: WorldEvent[]) {
        this.state.hp = Math.min(this.state.maxHp, this.state.hp + amount);
        ev.push({ kind: 'heal', amount });
        ev.push({ kind: 'player_hit', hp: this.state.hp, maxHp: this.state.maxHp });
    }

    // 渲染层用：玩家本帧是否在移动（外显"移动损失火力"）
    get isMoving(): boolean { return this._moving; }
}
