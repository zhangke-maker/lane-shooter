import { _decorator, Component, Node, Graphics, Color,
         input, Input, Touch, UITransform, view } from 'cc';
import { GameManager } from './GameManager';
import { Bullet } from './Bullet';
import { PLAYER_Y, PLAYER_MOVE_SPEED, PLAYER_MIN_X, PLAYER_MAX_X, BULLET_SPEED, SHOOT_INTERVAL } from './Const';
const { ccclass, property } = _decorator;

// 每个小人的相对偏移布局（最多10个，3排排布）
const PERSON_OFFSETS: [number, number][] = [
    [0, 0],                              // 1
    [-28, -20], [28, -20],               // 2-3
    [-28, 20],  [28, 20],                // 4-5
    [-56, -20], [56, -20],               // 6-7
    [-56, 20],  [56, 20],                // 8-9
    [0, -40],                            // 10
];

@ccclass('PlayerGroup')
export class PlayerGroup extends Component {

    @property(Node)
    bulletParent: Node = null;  // 子弹挂在场景根节点，避免跟随玩家移动

    private _graphics: Graphics[] = [];
    private _targetX = 0;
    private _shootTimer = 0;
    private _shootInterval = SHOOT_INTERVAL;  // 固定射速，靠武器伤害和人数区分强弱

    onLoad() {
        // 触摸/鼠标拖动控制
        input.on(Input.EventType.TOUCH_MOVE,  this._onTouchMove,  this);
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        this._redrawAll();
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_MOVE,  this._onTouchMove,  this);
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
    }

    private _onTouchStart(e: Touch) {
        this._updateTargetX(e.getUILocation().x);
    }

    private _onTouchMove(e: Touch) {
        this._updateTargetX(e.getUILocation().x);
    }

    private _updateTargetX(screenX: number) {
        // 将屏幕坐标转为场景坐标（原点在屏幕中心）
        const halfW = view.getVisibleSize().width / 2;
        this._targetX = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, screenX - halfW));
    }

    update(dt: number) {
        const gm = GameManager.inst;
        if (!gm || !gm.isRunning) return;

        // 平滑移动
        const cur = this.node.position;
        const dx = this._targetX - cur.x;
        const step = PLAYER_MOVE_SPEED * dt;
        const newX = Math.abs(dx) < step ? this._targetX : cur.x + Math.sign(dx) * step;
        this.node.setPosition(newX, PLAYER_Y, 0);

        // 射击
        this._shootTimer -= dt;
        if (this._shootTimer <= 0) {
            this._shootTimer = this._shootInterval;
            this._shoot();
        }

        // 人数变化时重绘
        if (this._graphics.length !== gm.state.personCount) {
            this._redrawAll();
        }
    }

    private _shoot() {
        const gm = GameManager.inst;
        if (!gm) return;
        const stat = gm.weaponStat;
        const count = gm.state.personCount;

        const n = Math.min(count, PERSON_OFFSETS.length);
        for (let i = 0; i < n; i++) {
            const off = PERSON_OFFSETS[i];
            const bNode = new Node('Bullet');
            bNode.addComponent(UITransform);
            const b = bNode.addComponent(Bullet);
            b.init(stat.damage, BULLET_SPEED, stat.bulletWidth, stat.color);

            const worldX = this.node.position.x + off[0];
            const worldY = this.node.position.y + off[1] + 40;  // 从小人头顶射出
            bNode.setPosition(worldX, worldY, 0);

            const parent = this.bulletParent ?? this.node.parent;
            parent.addChild(bNode);
        }
    }

    private _redrawAll() {
        const gm = GameManager.inst;
        if (!gm) return;
        const count = gm.state.personCount;

        // 移除旧的 Graphics 节点
        this._graphics.forEach(g => g.node.destroy());
        this._graphics = [];

        for (let i = 0; i < count; i++) {
            const off = PERSON_OFFSETS[i] ?? [0, 0];
            const pNode = new Node(`Person_${i}`);
            this.node.addChild(pNode);
            pNode.setPosition(off[0], off[1], 0);
            const g = pNode.addComponent(Graphics);
            this._drawPerson(g);
            this._graphics.push(g);
        }
    }

    private _drawPerson(g: Graphics) {
        g.clear();
        // 身体
        const bodyColor = new Color();
        Color.fromHEX(bodyColor, '#3DE0C8');
        g.fillColor = bodyColor;
        g.roundRect(-10, -16, 20, 22, 5);
        g.fill();
        // 头
        g.circle(0, -22, 8);
        g.fill();
        // 眼睛
        const eyeColor = new Color(12, 42, 37, 255);
        g.fillColor = eyeColor;
        g.circle(-3, -23, 2);
        g.fill();
        g.circle(3, -23, 2);
        g.fill();
    }
}
