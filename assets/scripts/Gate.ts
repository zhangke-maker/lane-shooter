import { _decorator, Component, Node, Graphics, Color, UITransform, Label } from 'cc';
import { GameManager } from './GameManager';
import { gameEvent } from './GameEvent';
import { GateType, EVT } from './Const';
import type { GateLane } from './GateLane';
const { ccclass } = _decorator;

export interface GateConfig {
    type: GateType;
    hp: number;
    label: string;
    healAmount?: number;
}

export const GATE_COLORS: Record<GateType, string> = {
    [GateType.WEAPON_UP]: '#3DE0C8',
    [GateType.PERSON_UP]: '#7EE9FF',
    [GateType.HEAL]:      '#34D399',
};

@ccclass('Gate')
export class Gate extends Component {

    public cfg: GateConfig = null;
    public currentHp = 0;
    public maxHp = 0;

    private _g: Graphics = null;
    private _hitFlash = 0;
    private _hpLabel: Label = null;
    private _gateLane: GateLane | null = null;  // GateLane 引用，打穿时回调
    private _isSlot0 = false;       // 是否是最前面的传送带道具（可被打）
    private _freeDrop = false;      // 是否是右路自由掉落（Boss 补血，始终可打、不走传送带）

    private readonly _W = 140;
    private readonly _H = 64;

    onLoad() {
        this._g = this.node.getComponent(Graphics) ?? this.node.addComponent(Graphics);
    }

    init(cfg: GateConfig, gateLane: GateLane | null = null, freeDrop = false) {
        this.cfg = cfg;
        this.maxHp = this.currentHp = cfg.hp;
        this._gateLane = gateLane;
        this._freeDrop = freeDrop;
        this._draw();
    }

    // 由 GateLane 标记此道具是否在槽0（可被打）
    setIsActiveSlot(active: boolean) {
        this._isSlot0 = active;
    }

    // 是否可被子弹击打：槽0传送带道具，或右路自由掉落
    get isHittable(): boolean {
        return this._isSlot0 || this._freeDrop;
    }

    takeDamage(dmg: number): boolean {
        if (!this.isHittable) return false;  // 只有当前目标道具可被打
        this.currentHp -= dmg;
        this._hitFlash = 0.08;
        this._draw();
        if (this.currentHp <= 0) {
            this._onCleared();
            return true;
        }
        return false;
    }

    private _onCleared() {
        const gm = GameManager.inst;
        if (!gm) return;
        switch (this.cfg.type) {
            case GateType.WEAPON_UP: gm.upgradeWeapon(); break;
            case GateType.PERSON_UP: gm.addPerson();     break;
            case GateType.HEAL:      gm.heal(this.cfg.healAmount ?? 30); break;
        }
        gameEvent.emit(EVT.GATE_CLEARED, this.cfg.type, this.cfg.label);

        // 通知传送带下移
        if (this._gateLane) {
            this._gateLane.onFrontGateCleared();
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
    }

    private _draw() {
        if (!this._g) return;
        this._g.clear();

        const flash = this._hitFlash > 0;
        const hexColor = GATE_COLORS[this.cfg.type];
        const c = new Color();
        Color.fromHEX(c, flash ? '#FFFFFF' : hexColor);

        const W = this._W, H = this._H;
        const ratio = this.maxHp > 0 ? Math.max(0, this.currentHp / this.maxHp) : 1;
        const active = this.isHittable;

        // 水晶背景（半透明）
        const bg = new Color();
        Color.fromHEX(bg, hexColor);
        bg.a = active ? 60 : 30;  // 非活跃槽位更透明
        this._g.fillColor = bg;
        this._g.roundRect(-W / 2, -H / 2, W, H, 12);
        this._g.fill();

        // 血量填充条
        if (active) {
            const barColor = new Color();
            Color.fromHEX(barColor, hexColor);
            barColor.a = 100;
            this._g.fillColor = barColor;
            this._g.roundRect(-W / 2, -H / 2, W * ratio, H, 12);
            this._g.fill();
        }

        // 水晶边框（活跃槽位更亮）
        this._g.strokeColor = c;
        this._g.lineWidth = active ? 3 : 1.5;
        this._g.roundRect(-W / 2, -H / 2, W, H, 12);
        this._g.stroke();

        // 水晶高光线（左上角斜线，装饰感）
        if (active) {
            const highlight = new Color(255, 255, 255, 60);
            this._g.strokeColor = highlight;
            this._g.lineWidth = 2;
            this._g.moveTo(-W / 2 + 16, -H / 2 + 8);
            this._g.lineTo(-W / 2 + 8, H / 2 - 12);
            this._g.stroke();
        }

        // 更新血量数字 Label（只在活跃槽位显示）
        this._updateHpLabel();
    }

    private _updateHpLabel() {
        // 找到子节点里的 Label（第一个名为 HpNum 的）
        let hpNode = this.node.getChildByName('HpNum');
        if (!hpNode) {
            hpNode = new Node('HpNum');
            this.node.addChild(hpNode);
            this._hpLabel = hpNode.addComponent(Label);
            this._hpLabel.fontSize = 28;
            this._hpLabel.isBold = true;
        } else if (!this._hpLabel) {
            this._hpLabel = hpNode.getComponent(Label);
        }
        if (this._hpLabel) {
            hpNode.active = this.isHittable;
            this._hpLabel.string = `${Math.max(0, Math.ceil(this.currentHp))}`;
            const c = new Color(234, 240, 250, 255);
            this._hpLabel.color = c;
            hpNode.setPosition(0, 4, 0);
        }
    }
}
