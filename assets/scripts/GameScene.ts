import { _decorator, Component, Node, Graphics, Color, view, UITransform } from 'cc';
import { LANE_LEFT_X, LANE_RIGHT_X, LANE_WIDTH, SCREEN_TOP, PLAYER_Y } from './Const';
const { ccclass, property } = _decorator;

// 场景根节点脚本：负责绘制静态背景（两条 lane 的底色和分割线）
@ccclass('GameScene')
export class GameScene extends Component {

    @property(Node) bgNode: Node = null;

    start() {
        this._drawBackground();
    }

    private _drawBackground() {
        const target = this.bgNode ?? this.node;
        const g = target.getComponent(Graphics) ?? target.addComponent(Graphics);
        g.clear();

        const halfW = 375, halfH = SCREEN_TOP;  // 375 = 750/2

        // 整体背景
        const bg = new Color(12, 15, 22, 255);
        g.fillColor = bg;
        g.rect(-halfW, -halfH, halfW * 2, halfH * 2);
        g.fill();

        // 左路（道具）底色
        const leftBg = new Color(20, 32, 48, 255);
        g.fillColor = leftBg;
        g.rect(LANE_LEFT_X - LANE_WIDTH / 2, -halfH, LANE_WIDTH, halfH * 2);
        g.fill();

        // 右路（怪物）底色
        const rightBg = new Color(32, 18, 22, 255);
        g.fillColor = rightBg;
        g.rect(LANE_RIGHT_X - LANE_WIDTH / 2, -halfH, LANE_WIDTH, halfH * 2);
        g.fill();

        // 中间分割线
        const divider = new Color(58, 74, 107, 200);
        g.strokeColor = divider;
        g.lineWidth = 3;
        g.moveTo(0, -halfH);
        g.lineTo(0, halfH);
        g.stroke();

        // 左路顶部标签区域（提示"道具"）
        const leftHint = new Color(52, 211, 153, 80);
        g.fillColor = leftHint;
        g.roundRect(LANE_LEFT_X - 50, halfH - 50, 100, 36, 8);
        g.fill();

        // 右路顶部标签区域（提示"敌人"）
        const rightHint = new Color(251, 77, 106, 80);
        g.fillColor = rightHint;
        g.roundRect(LANE_RIGHT_X - 50, halfH - 50, 100, 36, 8);
        g.fill();

        // 底线（玩家防守线）
        const baseline = new Color(61, 224, 200, 120);
        g.strokeColor = baseline;
        g.lineWidth = 2;
        g.moveTo(-halfW, PLAYER_Y);
        g.lineTo(halfW, PLAYER_Y);
        g.stroke();
    }
}
