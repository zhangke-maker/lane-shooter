import { _decorator, Component, Node, Graphics, Color, Vec3, UITransform } from 'cc';
import { GameManager } from './GameManager';
import { gameEvent } from './GameEvent';
import { EnemyType, EVT, BASELINE_Y } from './Const';
const { ccclass, property } = _decorator;

export interface EnemyConfig {
    type: EnemyType;
    hp: number;
    speed: number;        // px/s 向下移动速度
    damage: number;       // 到达底线造成的伤害
    scoreValue: number;
    healDrop: boolean;    // 击杀是否掉补血
    radius: number;       // 碰撞半径
}

// 各类型怪物基础配置（乘以波次系数后使用）
export const ENEMY_BASE: Record<EnemyType, EnemyConfig> = {
    [EnemyType.GRUNT]:     { type: EnemyType.GRUNT,     hp: 5,   speed: 120, damage: 5,   scoreValue: 10,  healDrop: false, radius: 22 },
    [EnemyType.RUNNER]:    { type: EnemyType.RUNNER,    hp: 3,   speed: 220, damage: 5,   scoreValue: 15,  healDrop: false, radius: 18 },
    [EnemyType.BRUTE]:     { type: EnemyType.BRUTE,     hp: 30,  speed: 70,  damage: 15,  scoreValue: 50,  healDrop: false, radius: 34 },
    [EnemyType.MINI_BOSS]: { type: EnemyType.MINI_BOSS, hp: 120, speed: 50,  damage: 25,  scoreValue: 150, healDrop: true,  radius: 44 },
    [EnemyType.BOSS]:      { type: EnemyType.BOSS,      hp: 400, speed: 35,  damage: 40,  scoreValue: 500, healDrop: true,  radius: 60 },
};

// 各类型颜色
const ENEMY_COLORS: Record<EnemyType, string> = {
    [EnemyType.GRUNT]:     '#C2D44A',
    [EnemyType.RUNNER]:    '#FF8A3C',
    [EnemyType.BRUTE]:     '#FF4D6D',
    [EnemyType.MINI_BOSS]: '#CC44FF',
    [EnemyType.BOSS]:      '#FF0044',
};

@ccclass('Enemy')
export class Enemy extends Component {

    public config: EnemyConfig = null;
    public currentHp = 0;
    public maxHp = 0;

    private _g: Graphics = null;
    private _hitFlash = 0;

    onLoad() {
        this._g = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    }

    init(cfg: EnemyConfig, waveScale: number) {
        this.config = { ...cfg };
        this.config.hp    = Math.round(cfg.hp    * waveScale);
        this.config.speed = Math.round(cfg.speed * (1 + (waveScale - 1) * 0.3));
        this.maxHp = this.currentHp = this.config.hp;
        this._draw();
    }

    takeDamage(dmg: number): boolean {
        this.currentHp -= dmg;
        this._hitFlash = 0.08;
        this._draw();
        if (this.currentHp <= 0) {
            this._onDeath();
            return true;
        }
        return false;
    }

    private _onDeath() {
        gameEvent.emit(EVT.ENEMY_KILLED, this.config);
        GameManager.inst?.addScore(this.config.scoreValue);
        if (this.config.healDrop) {
            // 通知 GateLane 在此位置（右路原地）生成补血水晶
            gameEvent.emit(EVT.HEAL_DROP, this.node.position.clone());
        }
        this.node.destroy();
    }

    update(dt: number) {
        const gm = GameManager.inst;
        if (!gm?.isRunning) return;

        if (this._hitFlash > 0) {
            this._hitFlash -= dt;
            this._draw();
        }

        const pos = this.node.position;
        const newY = pos.y - this.config.speed * dt;
        this.node.setPosition(pos.x, newY, 0);

        // 到达底线
        if (newY < BASELINE_Y) {
            gm.takeDamage(this.config.damage);
            this.node.destroy();
        }
    }

    private _draw() {
        if (!this._g) return;
        this._g.clear();

        const flash = this._hitFlash > 0;
        const c = new Color();
        Color.fromHEX(c, flash ? '#FFFFFF' : ENEMY_COLORS[this.config.type]);
        this._g.fillColor = c;

        const r = this.config.radius;

        if (this.config.type === EnemyType.BOSS) {
            // Boss：大六边形
            this._hexagon(0, 0, r);
        } else if (this.config.type === EnemyType.MINI_BOSS) {
            // 中Boss：五边形
            this._polygon(0, 0, r, 5);
        } else if (this.config.type === EnemyType.BRUTE) {
            // 重装：宽矩形+头
            this._g.roundRect(-r, -r * 0.6, r * 2, r * 1.2, 8);
            this._g.fill();
            this._g.circle(0, -r * 0.6 - 14, 12);
        } else {
            // 普通怪：圆
            this._g.circle(0, 0, r);
        }
        this._g.fill();

        // 血条（boss和中boss显示）
        if (this.config.type === EnemyType.BOSS || this.config.type === EnemyType.MINI_BOSS) {
            this._drawHpBar(r);
        }
    }

    private _drawHpBar(r: number) {
        const barW = r * 2.4;
        const barH = 6;
        const x = -barW / 2;
        const y = r + 8;
        const ratio = Math.max(0, this.currentHp / this.maxHp);

        // 背景
        const bg = new Color(40, 10, 10, 200);
        this._g.fillColor = bg;
        this._g.roundRect(x, y, barW, barH, 3);
        this._g.fill();

        // 血量
        const hp = new Color();
        Color.fromHEX(hp, '#FF5C7A');
        this._g.fillColor = hp;
        this._g.roundRect(x, y, barW * ratio, barH, 3);
        this._g.fill();
    }

    private _hexagon(cx: number, cy: number, r: number) {
        this._g.moveTo(cx + r, cy);
        for (let i = 1; i <= 6; i++) {
            const a = (Math.PI / 3) * i;
            this._g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        this._g.close();
    }

    private _polygon(cx: number, cy: number, r: number, sides: number) {
        this._g.moveTo(cx + r, cy);
        for (let i = 1; i <= sides; i++) {
            const a = (Math.PI * 2 / sides) * i - Math.PI / 2;
            this._g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        this._g.close();
    }
}
