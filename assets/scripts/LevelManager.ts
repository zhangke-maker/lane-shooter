import { _decorator, Component, Node, Label, Color } from 'cc';
import { GameManager } from './GameManager';
import { gameEvent } from './GameEvent';
import { EVT, GateType } from './Const';
import { EnemyType } from './Const';
const { ccclass, property } = _decorator;

export interface WaveDef {
    spawnInterval: number;
    normalCount: number;
    normalTypes: EnemyType[];
    hasMidBoss: boolean;
    midBossAt: number;
    bossType: EnemyType;
}

export interface LevelDef {
    levelIndex: number;
    waves: WaveDef[];
    // 道具水晶血量（秒数，运行时乘以当前DPS换算）
    gateSeconds: Record<GateType, number>;
}

// 5关配置
const LEVEL_DEFS: LevelDef[] = [
    // 关1：容错±5秒，只有一波
    {
        levelIndex: 1,
        gateSeconds: { [GateType.WEAPON_UP]: 5, [GateType.PERSON_UP]: 4, [GateType.HEAL]: 3 },
        waves: [
            { spawnInterval: 1.8, normalCount: 8,  normalTypes: [EnemyType.GRUNT],                          hasMidBoss: false, midBossAt: 0,  bossType: EnemyType.BRUTE },
        ],
    },
    // 关2：容错±3秒
    {
        levelIndex: 2,
        gateSeconds: { [GateType.WEAPON_UP]: 7, [GateType.PERSON_UP]: 5, [GateType.HEAL]: 4 },
        waves: [
            { spawnInterval: 1.4, normalCount: 12, normalTypes: [EnemyType.GRUNT, EnemyType.RUNNER],         hasMidBoss: true,  midBossAt: 6,  bossType: EnemyType.BRUTE },
        ],
    },
    // 关3：容错±2秒
    {
        levelIndex: 3,
        gateSeconds: { [GateType.WEAPON_UP]: 9, [GateType.PERSON_UP]: 6, [GateType.HEAL]: 5 },
        waves: [
            { spawnInterval: 1.1, normalCount: 16, normalTypes: [EnemyType.GRUNT, EnemyType.RUNNER],         hasMidBoss: true,  midBossAt: 8,  bossType: EnemyType.MINI_BOSS },
        ],
    },
    // 关4：容错±1.5秒
    {
        levelIndex: 4,
        gateSeconds: { [GateType.WEAPON_UP]: 11, [GateType.PERSON_UP]: 7, [GateType.HEAL]: 5 },
        waves: [
            { spawnInterval: 0.9, normalCount: 20, normalTypes: [EnemyType.GRUNT, EnemyType.RUNNER, EnemyType.BRUTE], hasMidBoss: true, midBossAt: 10, bossType: EnemyType.MINI_BOSS },
        ],
    },
    // 关5：容错±1秒，精确节奏
    {
        levelIndex: 5,
        gateSeconds: { [GateType.WEAPON_UP]: 13, [GateType.PERSON_UP]: 9, [GateType.HEAL]: 6 },
        waves: [
            { spawnInterval: 0.7, normalCount: 24, normalTypes: [EnemyType.RUNNER, EnemyType.BRUTE],         hasMidBoss: true,  midBossAt: 12, bossType: EnemyType.BOSS },
        ],
    },
];

@ccclass('LevelManager')
export class LevelManager extends Component {

    @property(Label)
    levelAnnounceLabel: Label = null;  // 关卡提示 Label（屏幕中央大字）

    private _currentLevel = 1;
    private _announceTimer = 0;

    static inst: LevelManager = null;

    onLoad() {
        LevelManager.inst = this;
        gameEvent.on(EVT.GAME_OVER, this._onGameOver, this);
    }

    onDestroy() {
        if (LevelManager.inst === this) LevelManager.inst = null;
        gameEvent.off(EVT.GAME_OVER, this._onGameOver, this);
    }

    // GameManager.startGame() 调用
    startLevel(level: number) {
        this._currentLevel = Math.min(level, LEVEL_DEFS.length);
        const def = LEVEL_DEFS[this._currentLevel - 1];

        const gm = GameManager.inst;
        if (gm) gm.state.level = this._currentLevel;  // 同步给 UI 显示

        // 通知 GateLane 初始化传送带（传本关击破秒数，血量由 GateLane 按当前 DPS 实时换算）
        gameEvent.emit(EVT.GATE_LANE_INIT, def.gateSeconds);

        // 关卡过渡：停2秒出怪，弹出关卡提示
        this._showLevelAnnounce(this._currentLevel);

        // 1.5秒后通知 WaveManager 开始出怪
        this.scheduleOnce(() => {
            gameEvent.emit(EVT.LEVEL_WAVES_START, def.waves, this._currentLevel);
        }, 2.0);
    }

    // Boss 死后进入下一关（由 WaveManager 调用）
    onLevelComplete() {
        const nextLevel = this._currentLevel + 1;
        if (nextLevel > LEVEL_DEFS.length) {
            // 通关
            GameManager.inst?.triggerGameOver();
            return;
        }
        const gm = GameManager.inst;
        if (gm) gm.state.wave = 1;

        // 延迟2秒后开始下一关
        this.scheduleOnce(() => {
            this.startLevel(nextLevel);
        }, 2.0);
    }

    getCurrentDef(): LevelDef | null {
        return LEVEL_DEFS[this._currentLevel - 1] ?? null;
    }

    private _showLevelAnnounce(level: number) {
        if (!this.levelAnnounceLabel) return;
        this.levelAnnounceLabel.node.active = true;
        this.levelAnnounceLabel.string = `第 ${level} 关`;
        const c = new Color(234, 240, 250, 255);
        this.levelAnnounceLabel.color = c;
        this._announceTimer = 1.5;
    }

    update(dt: number) {
        if (this._announceTimer > 0) {
            this._announceTimer -= dt;
            if (this._announceTimer <= 0 && this.levelAnnounceLabel) {
                this.levelAnnounceLabel.node.active = false;
            }
        }
    }

    private _onGameOver() {
        this.unscheduleAllCallbacks();
    }
}
