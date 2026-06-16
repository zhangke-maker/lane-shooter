import { _decorator, Component, Node, UITransform } from 'cc';
import { GameManager } from './GameManager';
import { gameEvent } from './GameEvent';
import { Enemy, ENEMY_BASE } from './Enemy';
import { EnemyType, EVT, LANE_RIGHT_X } from './Const';
import { WaveDef } from './LevelManager';
import { LevelManager } from './LevelManager';
const { ccclass, property } = _decorator;

@ccclass('WaveManager')
export class WaveManager extends Component {

    @property(Node)
    enemyParent: Node = null;

    private _waves: WaveDef[] = [];
    private _waveIndex = 0;      // 当前关卡内的波次索引（通常只有1波）
    private _levelIndex = 1;

    private _spawnTimer = 0;
    private _normalSpawned = 0;
    private _normalKilled = 0;
    private _midBossSpawned = false;
    private _bossSpawned = false;
    private _bossAlive = false;
    private _active = false;

    onLoad() {
        gameEvent.on(EVT.LEVEL_WAVES_START, this._onLevelWavesStart, this);
        gameEvent.on(EVT.ENEMY_KILLED,    this._onEnemyKilled,     this);
    }

    onDestroy() {
        gameEvent.off(EVT.LEVEL_WAVES_START, this._onLevelWavesStart, this);
        gameEvent.off(EVT.ENEMY_KILLED,    this._onEnemyKilled,     this);
    }

    private _onLevelWavesStart(waves: WaveDef[], levelIndex: number) {
        this._waves = waves;
        this._levelIndex = levelIndex;
        this._waveIndex = 0;
        this._startWave(0);
    }

    private _startWave(idx: number) {
        if (idx >= this._waves.length) return;
        this._spawnTimer = 1.0;
        this._normalSpawned = 0;
        this._normalKilled = 0;
        this._midBossSpawned = false;
        this._bossSpawned = false;
        this._bossAlive = false;
        this._active = true;

        gameEvent.emit(EVT.WAVE_START, idx + 1);
    }

    private _onEnemyKilled(cfg: { type: EnemyType }) {
        const isBossLike = cfg.type === EnemyType.BOSS || cfg.type === EnemyType.MINI_BOSS;
        if (!isBossLike) {
            // 普通怪计数（含 BRUTE，用于触发中Boss / 波次Boss 时机）
            this._normalKilled++;
            return;
        }

        // Boss 类（中Boss 或 波次Boss）死亡，解除阻塞，恢复出怪
        this._bossAlive = false;

        // 只有“波次Boss”（已 spawn 的最终 Boss）死亡才通关；
        // 中Boss 死亡只是放行后半段普通怪，不结束关卡。
        // 用 _bossSpawned 区分二者——中Boss 死时 _bossSpawned 仍为 false。
        if (this._bossSpawned) {
            this._active = false;
            this.scheduleOnce(() => {
                LevelManager.inst?.onLevelComplete();
            }, 1.5);
        }
    }

    update(dt: number) {
        if (!this._active) return;
        const gm = GameManager.inst;
        if (!gm?.isRunning) return;

        this._spawnTimer -= dt;
        if (this._spawnTimer > 0) return;

        const def = this._waves[this._waveIndex];
        if (!def) return;

        // 中Boss
        if (def.hasMidBoss && !this._midBossSpawned && !this._bossSpawned
            && this._normalKilled >= def.midBossAt) {
            this._spawnEnemy(EnemyType.MINI_BOSS);
            this._midBossSpawned = true;
            this._bossAlive = true;
            this._spawnTimer = 3.0;
            return;
        }

        // 波次Boss
        if (!this._bossSpawned && this._normalSpawned >= def.normalCount && !this._bossAlive) {
            this._spawnEnemy(def.bossType);
            this._bossSpawned = true;
            this._bossAlive = true;
            gameEvent.emit(EVT.WAVE_BOSS_START, this._waveIndex + 1);
            this._spawnTimer = 99;
            return;
        }

        // 普通怪
        if (this._normalSpawned < def.normalCount && !this._bossAlive) {
            const types = def.normalTypes;
            const type = types[Math.floor(Math.random() * types.length)];
            this._spawnEnemy(type);
            this._normalSpawned++;
            this._spawnTimer = def.spawnInterval;
        }
    }

    private _waveScale() {
        // 关卡系数：每关递增0.35
        return 1 + (this._levelIndex - 1) * 0.35;
    }

    private _spawnEnemy(type: EnemyType) {
        const node = new Node(`Enemy_${type}`);
        node.addComponent(UITransform);
        const e = node.addComponent(Enemy);
        e.init(ENEMY_BASE[type], this._waveScale());

        const rx = LANE_RIGHT_X + (Math.random() - 0.5) * 120;
        const spawnY = 667 + ENEMY_BASE[type].radius + 10;
        node.setPosition(rx, spawnY, 0);

        const parent = this.enemyParent ?? this.node.parent;
        parent.addChild(node);
    }
}
