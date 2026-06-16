import { _decorator, Component, Node, Vec3, Graphics, UITransform, Color } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('Bullet')
export class Bullet extends Component {

    public damage = 1;
    public speedY = 1200;
    public bulletWidth = 4;
    public bulletColor = '#FFE066';

    private _g: Graphics = null;

    onLoad() {
        this._g = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
        this._drawBullet();
    }

    init(damage: number, speedY: number, bulletWidth: number, color: string) {
        this.damage = damage;
        this.speedY = speedY;
        this.bulletWidth = bulletWidth;
        this.bulletColor = color;
        this._drawBullet();
    }

    private _drawBullet() {
        if (!this._g) return;
        this._g.clear();
        const c = new Color();
        Color.fromHEX(c, this.bulletColor);
        this._g.strokeColor = c;
        this._g.lineWidth = this.bulletWidth;
        this._g.moveTo(0, 0);
        this._g.lineTo(0, this.bulletWidth * 3);  // 子弹长度 = 粗细 * 3
        this._g.stroke();
    }

    update(dt: number) {
        const pos = this.node.position;
        this.node.setPosition(pos.x, pos.y + this.speedY * dt, pos.z);
        // 飞出屏幕上方则销毁
        if (this.node.position.y > 667) {
            this.node.destroy();
        }
    }
}
