import { _decorator, Component, Node, Vec3 } from 'cc';
import { GameManager } from './GameManager';
import { Bullet } from './Bullet';
import { Enemy } from './Enemy';
import { Gate } from './Gate';
const { ccclass, property } = _decorator;

// 纯代码碰撞检测（不依赖 Cocos 物理引擎，每帧遍历）
// 适合本游戏规模（同屏实体数 < 100）

// 道具门命中判定矩形（略小于 Gate 视觉尺寸 140×64，留容差）
const GATE_HIT_W = 140;
const GATE_HIT_H = 60;

@ccclass('CollisionManager')
export class CollisionManager extends Component {

    @property(Node) bulletParent: Node = null;
    @property(Node) enemyParent:  Node = null;
    @property(Node) gateParent:   Node = null;

    update(_dt: number) {
        const gm = GameManager.inst;
        if (!gm?.isRunning) return;

        const bullets  = this._getComponents(this.bulletParent, Bullet);
        const enemies  = this._getComponents(this.enemyParent,  Enemy);
        const gates    = this._getComponents(this.gateParent,   Gate);

        for (const b of bullets) {
            if (!b.isValid || !b.node.isValid) continue;
            const bp = b.node.position;
            const isLeftLane = bp.x < 0;

            // 左路：子弹只打道具门
            if (isLeftLane) {
                this._hitGate(b, bp, gates);
                continue;
            }

            // 右路：子弹优先打怪；没命中怪再检测右路自由掉落的补血水晶（Boss 掉落）
            if (this._hitEnemy(b, bp, enemies)) continue;
            this._hitGate(b, bp, gates);
        }
    }

    // 子弹 vs 怪物：命中返回 true 并销毁子弹
    private _hitEnemy(b: Bullet, bp: Vec3, enemies: Enemy[]): boolean {
        for (const e of enemies) {
            if (!e.isValid || !e.node.isValid) continue;
            const ep = e.node.position;
            const dx = bp.x - ep.x, dy = bp.y - ep.y;
            const r  = e.config.radius + b.bulletWidth * 0.5;
            if (dx * dx + dy * dy < r * r) {
                e.takeDamage(b.damage);
                b.node.destroy();
                return true;
            }
        }
        return false;
    }

    // 子弹 vs 道具门：仅当门可打（takeDamage 命中生效）才销毁子弹
    private _hitGate(b: Bullet, bp: Vec3, gates: Gate[]): boolean {
        for (const g of gates) {
            if (!g.isValid || !g.node.isValid) continue;
            if (!this._rectHit(bp, g.node.position, GATE_HIT_W, GATE_HIT_H)) continue;
            if (!g.isHittable) continue;  // 非活跃槽位的门：子弹穿过，不消耗
            g.takeDamage(b.damage);
            b.node.destroy();
            return true;
        }
        return false;
    }

    private _getComponents<T>(parent: Node, type: new (...args: any[]) => T): T[] {
        if (!parent) return [];
        const result: T[] = [];
        parent.children.forEach(child => {
            const c = child.getComponent(type);
            if (c) result.push(c);
        });
        return result;
    }

    private _rectHit(point: Vec3, center: Vec3, w: number, h: number): boolean {
        return Math.abs(point.x - center.x) < w / 2
            && Math.abs(point.y - center.y) < h / 2;
    }
}
