import { _decorator, Component } from 'cc';
import { EVT, WeaponLevel, WEAPON_STATS, SHOOT_INTERVAL } from './Const';
import { gameEvent } from './GameEvent';
import { LevelManager } from './LevelManager';
const { ccclass } = _decorator;

export interface PlayerState {
    hp: number;
    maxHp: number;
    weaponLevel: WeaponLevel;
    personCount: number;
    score: number;
    wave: number;
    level: number;
}

@ccclass('GameManager')
export class GameManager extends Component {

    private static _inst: GameManager = null;
    static get inst() { return GameManager._inst; }

    public state: PlayerState = {
        hp: 100,
        maxHp: 100,
        weaponLevel: WeaponLevel.PISTOL,
        personCount: 1,
        score: 0,
        wave: 1,
        level: 1,
    };

    public isRunning = false;
    public isGameOver = false;

    onLoad() {
        GameManager._inst = this;
    }

    onDestroy() {
        if (GameManager._inst === this) GameManager._inst = null;
    }

    startGame() {
        this.state = {
            hp: 100,
            maxHp: 100,
            weaponLevel: WeaponLevel.PISTOL,
            personCount: 1,
            score: 0,
            wave: 1,
            level: 1,
        };
        this.isRunning = true;
        this.isGameOver = false;

        // 通知 UI 同步
        gameEvent.emit(EVT.PLAYER_HIT, this.state.hp, this.state.maxHp);
        gameEvent.emit(EVT.SCORE_CHANGE, 0);

        // 由 LevelManager 接管后续流程
        LevelManager.inst?.startLevel(1);
    }

    takeDamage(amount: number) {
        if (this.isGameOver) return;
        this.state.hp = Math.max(0, this.state.hp - amount);
        gameEvent.emit(EVT.PLAYER_HIT, this.state.hp, this.state.maxHp);
        if (this.state.hp <= 0) this.triggerGameOver();
    }

    heal(amount: number) {
        this.state.hp = Math.min(this.state.maxHp, this.state.hp + amount);
        gameEvent.emit(EVT.PLAYER_HIT, this.state.hp, this.state.maxHp);
    }

    upgradeWeapon() {
        if (this.state.weaponLevel < WeaponLevel.LASER) {
            this.state.weaponLevel++;
        }
    }

    addPerson() {
        if (this.state.personCount < 10) {
            this.state.personCount++;
        }
    }

    addScore(val: number) {
        this.state.score += val;
        gameEvent.emit(EVT.SCORE_CHANGE, this.state.score);
    }

    get weaponStat() {
        return WEAPON_STATS[this.state.weaponLevel];
    }

    // 当前每秒伤害 = 武器伤害 × 人数 × 射速。水晶血量按此换算，保证各等级体感一致
    get dps() {
        return this.weaponStat.damage * this.state.personCount * (1 / SHOOT_INTERVAL);
    }

    triggerGameOver() {
        if (this.isGameOver) return;
        this.isGameOver = true;
        this.isRunning = false;
        gameEvent.emit(EVT.GAME_OVER, this.state);
    }
}
