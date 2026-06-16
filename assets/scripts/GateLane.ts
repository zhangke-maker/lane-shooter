import { _decorator, Component, Node, Vec3, Color, UITransform, Label } from 'cc';
import { GameManager } from './GameManager';
import { gameEvent } from './GameEvent';
import { GateType, EVT, SHOOT_INTERVAL, LANE_LEFT_X, SCREEN_TOP } from './Const';
import { Gate, GateConfig } from './Gate';
const { ccclass, property } = _decorator;

// 4个固定槽位的 Y 坐标（从下到上：槽0最靠近玩家，槽3最远）
const SLOT_Y = [-160, 60, 280, 500];
// 道具下移动画速度（px/s）
const SLIDE_SPEED = 400;

// 道具序列（循环使用）。hp 占位为 0，实际由 _buildHpTable 按当前 DPS 换算
const GATE_SEQUENCE: GateConfig[] = [
    { type: GateType.WEAPON_UP, hp: 0, label: '武器升级' },
    { type: GateType.PERSON_UP, hp: 0, label: '+1 人' },
    { type: GateType.HEAL, hp: 0, label: '+40 血', healAmount: 40 },
    { type: GateType.WEAPON_UP, hp: 0, label: '武器升级' },
    { type: GateType.HEAL, hp: 0, label: '+20 血', healAmount: 20 },
    { type: GateType.PERSON_UP, hp: 0, label: '+1 人' },
    { type: GateType.HEAL, hp: 0, label: '+70 血', healAmount: 70 },
    { type: GateType.WEAPON_UP, hp: 0, label: '武器升级' },
];

@ccclass('GateLane')
export class GateLane extends Component {

    @property(Node)
    gateParent: Node = null;

    // 当前槽位上的 Gate 节点（index 0 = 最靠近玩家）
    private _slots: (Node | null)[] = [null, null, null, null];
    // 道具序列指针
    private _seqIndex = 0;
    // 槽位正在下移动画中（槽index → 目标Y）
    private _sliding: Map<number, number> = new Map();
    // 当前关卡各道具的击破秒数（设计锚点，运行时 × 当前DPS 得到水晶血量）
    private _gateSeconds: Record<GateType, number> = {
        [GateType.WEAPON_UP]: 8, [GateType.PERSON_UP]: 5, [GateType.HEAL]: 5,
    };

    onLoad() {
        gameEvent.on(EVT.GATE_LANE_INIT, this._onInit, this);
        gameEvent.on(EVT.HEAL_DROP, this._onHealDrop, this);
    }

    onDestroy() {
        gameEvent.off(EVT.GATE_LANE_INIT, this._onInit, this);
        gameEvent.off(EVT.HEAL_DROP, this._onHealDrop, this);
    }

    // 关卡开始时初始化（由 LevelManager 通过 EVT.GATE_LANE_INIT 调用）
    // 收到的是各道具「击破秒数」，水晶血量按当前 DPS 实时换算（初始与补入一致）
    _onInit(gateSeconds: Record<GateType, number>) {
        this._gateSeconds = gateSeconds;

        // 清除旧道具：槽位 + 残留的 Boss 掉落补血水晶（自由掉落不在 _slots 里管理）
        const parent = this.gateParent ?? this.node.parent;
        parent?.removeAllChildren();
        this._slots = [null, null, null, null];
        this._sliding.clear();
        this._seqIndex = 0;

        // 填满4个槽位
        const hpTable = this._buildHpTable();
        for (let i = 0; i < 4; i++) {
            this._fillSlot(i, hpTable);
        }
        this._syncActiveSlot();
    }

    update(dt: number) {
        const gm = GameManager.inst;
        if (!gm?.isRunning) return;

        this._syncActiveSlot();

        // 处理下移动画
        for (const [slotIdx, targetY] of this._sliding) {
            const node = this._slots[slotIdx];
            if (!node || !node.isValid) {
                this._sliding.delete(slotIdx);
                continue;
            }
            const pos = node.position;
            const dy = targetY - pos.y;
            if (Math.abs(dy) < 2) {
                node.setPosition(pos.x, targetY, 0);
                this._sliding.delete(slotIdx);
            } else {
                const step = Math.sign(dy) * SLIDE_SPEED * dt;
                node.setPosition(pos.x, pos.y + step, 0);
            }
        }
    }

    // 每帧同步槽0标记，确保只有最前面的道具可被击打
    private _syncActiveSlot() {
        for (let i = 0; i < 4; i++) {
            const node = this._slots[i];
            if (!node || !node.isValid) continue;
            const gate = node.getComponent(Gate);
            if (gate) gate.setIsActiveSlot(i === 0);
        }
    }

    // 槽位0被打掉后调用（由 Gate 通过事件通知）
    onFrontGateCleared() {
        // 槽0道具已销毁，上方道具依次下移
        this._slots[0] = null;
        for (let i = 0; i < 3; i++) {
            this._slots[i] = this._slots[i + 1];
            if (this._slots[i]) {
                this._sliding.set(i, SLOT_Y[i]);
            }
        }
        this._slots[3] = null;

        // 在最顶部补入新道具（按当前 DPS + 本关秒数换算血量，与初始一致）
        const hpTable = this._buildHpTable();
        this._fillSlot(3, hpTable);
        const node = this._slots[3];
        if (node) {
            // 新道具从屏幕顶部外侧滑入
            node.setPosition(node.position.x, SCREEN_TOP + 80, 0);
            this._sliding.set(3, SLOT_Y[3]);
        }
    }

    private _fillSlot(slotIdx: number, hpTable: Record<GateType, number>) {
        const cfg = this._nextGateConfig(hpTable);
        const node = this._createGateNode(cfg, LANE_LEFT_X, SLOT_Y[slotIdx]);
        this._slots[slotIdx] = node;
    }

    private _nextGateConfig(hpTable: Record<GateType, number>): GateConfig {
        const gm = GameManager.inst;
        // 跳过已满级的道具
        let tries = 0;
        while (tries < GATE_SEQUENCE.length) {
            const template = GATE_SEQUENCE[this._seqIndex % GATE_SEQUENCE.length];
            this._seqIndex++;
            tries++;

            if (template.type === GateType.WEAPON_UP && gm && gm.state.weaponLevel >= 5) continue;
            if (template.type === GateType.PERSON_UP && gm && gm.state.personCount >= 10) continue;

            return {
                type: template.type,
                hp: hpTable[template.type],
                label: template.label,
                healAmount: template.healAmount,
            };
        }
        // 全满级时退化为补血
        return { type: GateType.HEAL, hp: hpTable[GateType.HEAL] ?? 30, label: '+40 血', healAmount: 40 };
    }

    // 创建一个道具水晶节点。x 默认左路；freeDrop=true 时为右路自由掉落（始终可打、不回调传送带）
    private _createGateNode(cfg: GateConfig, x: number, y: number, freeDrop = false): Node {
        const node = new Node(`Gate_${cfg.type}`);
        node.addComponent(UITransform);
        const g = node.addComponent(Gate);
        g.init(cfg, freeDrop ? null : this, freeDrop);  // 传送带道具传 this 以便打穿回调；自由掉落不回调
        node.setPosition(x, y, 0);

        const labelNode = new Node('Label');
        node.addChild(labelNode);
        labelNode.setPosition(0, 0, 0);
        const lbl = labelNode.addComponent(Label);
        lbl.string = cfg.label;
        lbl.fontSize = 20;
        lbl.color = new Color(234, 240, 250, 255);

        const parent = this.gateParent ?? this.node.parent;
        parent.addChild(node);
        return node;
    }

    // 按当前 DPS × 本关击破秒数换算水晶血量，使各武器等级体感一致
    private _buildHpTable(): Record<GateType, number> {
        const dps = GameManager.inst?.dps ?? (1 / SHOOT_INTERVAL);
        const s = this._gateSeconds;
        return {
            [GateType.WEAPON_UP]: Math.max(10, Math.round(dps * s[GateType.WEAPON_UP])),
            [GateType.PERSON_UP]: Math.max(8,  Math.round(dps * s[GateType.PERSON_UP])),
            [GateType.HEAL]:      Math.max(5,  Math.round(dps * s[GateType.HEAL])),
        };
    }

    // Boss 死亡掉落：在右路原地生成一发即破的补血水晶（spec §3.3）
    private _onHealDrop(pos: Vec3) {
        const cfg: GateConfig = { type: GateType.HEAL, hp: 1, label: '+50 血', healAmount: 50 };
        const x = Math.max(0, pos.x);  // 钳制到右路（X≥0），避免越过分割线落到左路
        this._createGateNode(cfg, x, pos.y, true);
    }
}
