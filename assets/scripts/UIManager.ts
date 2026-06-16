import { _decorator, Component, Node, Label, ProgressBar, Button, Color, Sprite } from 'cc';
import { GameManager } from './GameManager';
import { gameEvent } from './GameEvent';
import { EVT, WEAPON_NAMES } from './Const';
const { ccclass, property } = _decorator;

@ccclass('UIManager')
export class UIManager extends Component {

    // HUD
    @property(ProgressBar) hpBar:       ProgressBar = null;
    @property(Label)       hpLabel:     Label = null;
    @property(Label)       scoreLabel:  Label = null;
    @property(Label)       waveLabel:   Label = null;
    @property(Label)       levelLabel:  Label = null;
    @property(Label)       weaponLabel: Label = null;
    @property(Label)       personLabel: Label = null;

    // 开始界面
    @property(Node)   startScreen: Node = null;
    @property(Button) startBtn:    Button = null;

    // 结算界面
    @property(Node)   overScreen:       Node = null;
    @property(Label)  finalScoreLabel:  Label = null;
    @property(Label)  finalLevelLabel:  Label = null;
    @property(Button) restartBtn:       Button = null;

    // 波次/关卡提示（屏幕中央大字，同一个 Label 复用）
    @property(Label) waveAnnounce: Label = null;

    onLoad() {
        gameEvent.on(EVT.PLAYER_HIT,      this._onHpChange,    this);
        gameEvent.on(EVT.SCORE_CHANGE,    this._onScoreChange, this);
        gameEvent.on(EVT.GAME_OVER,       this._onGameOver,    this);
        gameEvent.on(EVT.WAVE_START,      this._onWaveStart,   this);
        gameEvent.on(EVT.WAVE_BOSS_START, this._onBossStart,   this);
        gameEvent.on(EVT.GATE_CLEARED,    this._onGateCleared, this);

        this.startBtn?.node.on(Button.EventType.CLICK,   this._onStartClick, this);
        this.restartBtn?.node.on(Button.EventType.CLICK, this._onStartClick, this);
    }

    onDestroy() {
        gameEvent.off(EVT.PLAYER_HIT,      this._onHpChange,    this);
        gameEvent.off(EVT.SCORE_CHANGE,    this._onScoreChange, this);
        gameEvent.off(EVT.GAME_OVER,       this._onGameOver,    this);
        gameEvent.off(EVT.WAVE_START,      this._onWaveStart,   this);
        gameEvent.off(EVT.WAVE_BOSS_START, this._onBossStart,   this);
        gameEvent.off(EVT.GATE_CLEARED,    this._onGateCleared, this);
    }

    start() {
        if (this.startScreen) this.startScreen.active = true;
        if (this.overScreen)  this.overScreen.active  = false;
        if (this.waveAnnounce) this.waveAnnounce.node.active = false;
        this._syncHud();
    }

    private _onStartClick() {
        if (this.startScreen) this.startScreen.active = false;
        if (this.overScreen)  this.overScreen.active  = false;
        GameManager.inst?.startGame();
        this._syncHud();
    }

    private _onHpChange(hp: number, maxHp: number) {
        if (this.hpBar) {
            this.hpBar.progress = hp / maxHp;
            this._updateHpBarColor(hp / maxHp);
        }
        if (this.hpLabel) this.hpLabel.string = `${Math.ceil(hp)}`;
    }

    // 血条颜色：满血绿 → 半血黄 → 低血红（连续渐变）
    private _updateHpBarColor(ratio: number) {
        if (!this.hpBar) return;
        // ProgressBar 驱动的填充 Sprite：优先用 barSprite，回退到本节点 Sprite
        const fillSprite = this.hpBar.barSprite ?? this.hpBar.getComponent(Sprite);
        if (!fillSprite) return;

        const c = new Color();
        c.a = 255;
        if (ratio > 0.5) {
            // 绿(0,220,50) → 黄(220,220,50)
            const t = (ratio - 0.5) * 2;          // 1→0 随血量下降
            c.r = Math.round(220 * (1 - t));
            c.g = 220;
            c.b = 50;
        } else {
            // 黄(220,220,30) → 红(220,40,30)
            const t = ratio * 2;                  // 1→0 随血量下降
            c.r = 220;
            c.g = Math.round(40 + 180 * t);
            c.b = 30;
        }
        fillSprite.color = c;
    }

    private _onScoreChange(score: number) {
        if (this.scoreLabel) this.scoreLabel.string = `${score}`;
    }

    private _onWaveStart(wave: number) {
        if (this.waveLabel) this.waveLabel.string = `第 ${wave} 波`;
        this._announce(`第 ${wave} 波`);
        this._syncHud();
    }

    private _onBossStart(_wave: number) {
        this._announce(`⚠ BOSS 来袭！`, '#FF2244');
    }

    private _onGateCleared(_type: string, label: string) {
        this._announce(`✦ ${label}`, '#3DE0C8');
        this._syncHud();
    }

    private _onGameOver(state: any) {
        if (this.overScreen)     this.overScreen.active = true;
        if (this.finalScoreLabel) this.finalScoreLabel.string = `${state.score}`;
        if (this.finalLevelLabel) this.finalLevelLabel.string = `第 ${state.level ?? 1} 关`;
    }

    private _syncHud() {
        const gm = GameManager.inst;
        if (!gm) return;
        const s = gm.state;
        if (this.hpBar) {
            this.hpBar.progress = s.hp / s.maxHp;
            this._updateHpBarColor(s.hp / s.maxHp);
        }
        if (this.hpLabel)    this.hpLabel.string    = `${Math.ceil(s.hp)}`;
        if (this.scoreLabel) this.scoreLabel.string = `${s.score}`;
        if (this.waveLabel)  this.waveLabel.string  = `第 ${s.wave} 波`;
        if (this.levelLabel) this.levelLabel.string = `第 ${s.level ?? 1} 关`;
        if (this.weaponLabel) this.weaponLabel.string = WEAPON_NAMES[s.weaponLevel];
        if (this.personLabel) this.personLabel.string = `×${s.personCount}`;
    }

    private _announceTimer = 0;

    private _announce(text: string, hexColor = '#EAF0FA') {
        if (!this.waveAnnounce) return;
        this.waveAnnounce.string = text;
        const c = new Color();
        Color.fromHEX(c, hexColor);
        this.waveAnnounce.color = c;
        this.waveAnnounce.node.active = true;
        this._announceTimer = 2.0;
    }

    update(dt: number) {
        if (this._announceTimer > 0) {
            this._announceTimer -= dt;
            if (this._announceTimer <= 0 && this.waveAnnounce) {
                this.waveAnnounce.node.active = false;
            }
        }
    }
}
