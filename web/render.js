// 网页 Canvas 渲染层 —— 读 GameWorld 快照画图，复用纯TS核心（零改动）
// 坐标系：world 原点屏幕中心、Y 向上；canvas 原点左上、Y 向下 → 需翻转
import {
    LANE_LEFT_X, LANE_RIGHT_X, SCREEN_TOP, PLAYER_Y, BASELINE_Y, weaponStat, weaponName, personLayout,
} from './lib/types.js';

const W = 375, H = 667;   // 逻辑半宽/半高（world 范围 X∈[-375,375] Y∈[-667,667] 的一半）

const ENEMY_COLORS = {
    grunt: '#C2D44A', runner: '#FF8A3C', brute: '#FF4D6D', mini_boss: '#CC44FF', boss: '#FF0044',
};
const GATE_COLORS = { weapon_up: '#3DE0C8', person_up: '#7EE9FF' };

export class Renderer {
    constructor(canvas) {
        this.cv = canvas;
        this.ctx = canvas.getContext('2d');
        // canvas 像素尺寸固定 750×1334，CSS 缩放
        this.cv.width = 750; this.cv.height = 1334;
        this.scale = 1;
        this.reset();
    }

    // juice 状态：震屏强度、受伤闪红、击杀火花、升级弹字
    reset() {
        this.shake = 0;          // 屏幕震动强度（衰减）
        this.hurtFlash = 0;      // 受伤红闪（0~1 衰减）
        this.sparks = [];        // 击杀火花 {x,y,life,col}
        this.pops = [];          // 升级弹字 {life,text,col}
        this.banner = null;      // 关卡横幅（大字居中，过关/进关用）
        this._lastHp = Infinity; // 上帧HP（判掉血→红闪）；Infinity 使新局首次受伤必触发
        this.t = 0;
    }

    // 消费 world 事件做反馈（juice 必须外显，否则是 fake difficulty）
    consume(events) {
        for (const e of events) {
            if (e.kind === 'enemy_killed') {
                // 击杀火花：在右路出几粒
                for (let i = 0; i < 5; i++)
                    this.sparks.push({ x: LANE_RIGHT_X + (Math.random()-0.5)*60, y: -380 + (Math.random()-0.5)*80,
                                       vx: (Math.random()-0.5)*8, vy: 4+Math.random()*6, life: 1, col: '#FFD86B' });
            } else if (e.kind === 'player_hit' && e.hp < this._lastHp) {
                // 掉血时闪红+震屏
                this.hurtFlash = 1; this.shake = Math.max(this.shake, 14);
            } else if (e.kind === 'weapon_up') {
                // 显示升到的具体武器名（不是泛泛"UP"），让"变强"可感知
                this.pops.push({ life: 1.6, text: '⬆ ' + weaponName(e.level), col: weaponStat(e.level).color });
                this.shake = Math.max(this.shake, 6);
            } else if (e.kind === 'person_up') {
                // 翻倍加人：本次新增 = 新总数的一半(count 是翻倍后的总人数)
                this.pops.push({ life: 1.6, text: '+' + Math.floor(e.count / 2) + ' 人 → ×' + e.count, col: '#7EE9FF' });
            } else if (e.kind === 'level_clear') {
                this.banner = { life: 2.2, text: '第 ' + e.level + ' 关 通关！', col: '#3DE0C8' };
                this.shake = Math.max(this.shake, 12);
            } else if (e.kind === 'level_start') {
                this.banner = { life: 1.8, text: '▶ 第 ' + e.level + ' 关', col: '#FFD86B' };
            }
            if (e.kind === 'player_hit') this._lastHp = e.hp;
        }
    }

    // world 坐标 → canvas 像素
    tx(x) { return (x + W) * (750 / (W * 2)); }
    ty(y) { return (SCREEN_TOP - y) * (1334 / (SCREEN_TOP * 2)); }

    draw(world) {
        const c = this.ctx;
        this.t += 1 / 60;
        c.save();
        // 震屏：随机偏移画布，强度衰减
        if (this.shake > 0.2) {
            c.translate((Math.random()-0.5)*this.shake, (Math.random()-0.5)*this.shake);
            this.shake *= 0.85;
        }
        c.clearRect(-30, -30, 810, 1394);
        this._bg(c);
        this._gates(c, world);
        this._enemies(c, world);
        this._bullets(c, world);
        this._player(c, world);
        this._fx(c);            // 火花 + 弹字
        this._hud(c, world);
        this._hurt(c);          // 受伤红闪覆盖
        c.restore();
    }

    // ---- juice 绘制 ----
    _fx(c) {
        // 火花
        for (const s of this.sparks) {
            const x = this.tx(s.x), y = this.ty(s.y);
            c.globalAlpha = Math.max(0, s.life);
            c.fillStyle = s.col;
            c.beginPath(); c.arc(x + s.vx*8*(1-s.life), y + s.vy*8*(1-s.life), 5*s.life, 0, Math.PI*2); c.fill();
            s.life -= 0.06;
        }
        c.globalAlpha = 1;
        this.sparks = this.sparks.filter(s => s.life > 0);
        // 升级弹字（在玩家上方往上飘，大字、慢衰减让玩家看清"变强了"）
        let stackI = 0;
        for (const p of this.pops) {
            const prog = 1.6 - p.life;                       // 0→1.6 进度
            const y = this.ty(PLAYER_Y) - 150 - prog * 90 - stackI * 8;
            c.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
            c.fillStyle = p.col; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.font = 'bold 40px sans-serif';
            c.fillText(p.text, 375, y);
            p.life -= 0.018; stackI++;
        }
        c.globalAlpha = 1;
        this.pops = this.pops.filter(p => p.life > 0);
        // 关卡横幅（屏幕中央偏上，大字带描边，过关/进关醒目）
        if (this.banner && this.banner.life > 0) {
            const b = this.banner;
            c.globalAlpha = Math.max(0, Math.min(1, b.life));
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.font = 'bold 64px sans-serif';
            c.lineWidth = 8; c.strokeStyle = 'rgba(0,0,0,0.7)';
            c.strokeText(b.text, 375, 480);
            c.fillStyle = b.col; c.fillText(b.text, 375, 480);
            c.globalAlpha = 1;
            b.life -= 0.014;
            if (b.life <= 0) this.banner = null;
        }
    }

    _hurt(c) {
        if (this.hurtFlash > 0.02) {
            c.fillStyle = `rgba(255,40,40,${this.hurtFlash * 0.35})`;
            c.fillRect(-30, -30, 810, 1394);
            this.hurtFlash *= 0.82;
        }
    }

    _bg(c) {
        c.fillStyle = '#0c0f16'; c.fillRect(0, 0, 750, 1334);
        // 左路
        c.fillStyle = '#142030';
        c.fillRect(this.tx(LANE_LEFT_X - 170), 0, 340, 1334);
        // 右路
        c.fillStyle = '#201216';
        c.fillRect(this.tx(LANE_RIGHT_X - 170), 0, 340, 1334);
        // 分割线
        c.strokeStyle = 'rgba(58,74,107,0.8)'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(this.tx(0), 0); c.lineTo(this.tx(0), 1334); c.stroke();
        // 底线
        c.strokeStyle = 'rgba(61,224,200,0.5)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, this.ty(BASELINE_Y)); c.lineTo(750, this.ty(BASELINE_Y)); c.stroke();
    }

    _gates(c, w) {
        for (const g of w.gates) {
            const x = this.tx(g.x), y = this.ty(g.y);
            const gw = 140, gh = 64;
            const active = g.slot === 0;   // 只有 slot0(玩家正在打的)是活跃门、显示血量
            const col = GATE_COLORS[g.type] || '#888';
            // 进度填充（slot0 才显示打穿进度条；后排只画框，不显示进度）
            const prog = Math.max(0, Math.min(1, g.progress || 0));
            c.fillStyle = this._hexA(col, active ? 0.25 : 0.12);
            this._roundRect(c, x - gw / 2, y - gh / 2, gw, gh, 12); c.fill();
            if (active) {
                c.fillStyle = this._hexA(col, 0.4);
                this._roundRect(c, x - gw / 2, y - gh / 2, gw * prog, gh, 12); c.fill();
            }
            c.strokeStyle = col; c.lineWidth = active ? 3 : 1.5;
            this._roundRect(c, x - gw / 2, y - gh / 2, gw, gh, 12); c.stroke();
            // 文字（道具名）。加人门动态显示"轮到它打穿时"会加多少人——翻倍机制下,
            // 它前面(slot 更小=更靠下,会先打穿)每多一个加人门,人数就先翻倍一次。
            // 所以本门加的量 = 当前人数 × 2^(前面更靠下的加人门数)。修"后排门显当前人数=错、到底才对"的 bug。
            let label = g.label;
            if (g.type === 'person_up') {
                let ahead = 0;
                for (const o of w.gates) if (o.type === 'person_up' && o.slot < g.slot) ahead++;
                const before = w.state.personCount * Math.pow(2, ahead);   // 打穿前人数(无上限)
                label = `+${before} 人`;   // 翻倍机制下加的量 = 打穿前人数(翻倍后-翻倍前 = before)
            }
            c.fillStyle = '#eaf0fa'; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.font = '20px sans-serif'; c.fillText(label, x, y);
        }
    }

    _enemies(c, w) {
        // 先画普通怪、后画波次 Boss → Boss 永远在怪海【最上方】不被遮挡(用户要求 z-order)。
        // isWaveBoss 标记本关 Boss(与类型无关,可能是 brute/mini_boss/boss)。
        const ordered = [...w.enemies].sort((a, b) => (a.isWaveBoss ? 1 : 0) - (b.isWaveBoss ? 1 : 0));
        for (const e of ordered) {
            // 视觉分级：怪越硬(maxHp 越高)→越大 + 颜色越红。强度一眼可辨(业界可读性标准)。
            // tier 0~1：按 maxHp 对数分级（怪海里 hp 跨度大，用 log 压缩）
            const tier = Math.max(0, Math.min(1, Math.log2(Math.max(1, e.maxHp)) / 7));  // hp 1~128 → 0~1
            const x = this.tx(e.x), y = this.ty(e.y);
            const r = e.cfg.radius * (1 + tier * 0.8);   // 越硬越大（最多 1.8 倍）
            c.fillStyle = this._tierColor(e.cfg.type, tier);
            if (e.cfg.type === 'boss' || e.cfg.type === 'mini_boss') {
                this._poly(c, x, y, r, e.cfg.type === 'boss' ? 6 : 5); c.fill();
            } else if (e.cfg.type === 'brute') {
                this._roundRect(c, x - r, y - r * 0.6, r * 2, r * 1.2, 8); c.fill();
            } else {
                c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
            }
            // 高 tier 普通怪加深色描边（剪影增强可读性）
            if (tier > 0.4 && e.cfg.type !== 'boss' && e.cfg.type !== 'mini_boss') {
                c.strokeStyle = 'rgba(120,0,20,0.8)'; c.lineWidth = 2 + tier * 3;
                if (e.cfg.type === 'brute') { this._roundRect(c, x - r, y - r*0.6, r*2, r*1.2, 8); c.stroke(); }
                else { c.beginPath(); c.arc(x, y, r, 0, Math.PI*2); c.stroke(); }
            }
            // Boss 血条：按 isWaveBoss 判断(本关关底 Boss,与类型无关——L1/L2 的 BRUTE Boss 也有,普通 brute 小怪没有)。
            if (e.isWaveBoss) {
                const bw = Math.max(r * 2.4, 90), bh = 8, by = y - r - 18;
                const ratio = Math.max(0, e.hp / e.maxHp);
                c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x - bw/2 - 1, by - 1, bw + 2, bh + 2);   // 黑边底
                c.fillStyle = 'rgba(60,15,15,0.9)'; c.fillRect(x - bw/2, by, bw, bh);                  // 空槽
                c.fillStyle = ratio > 0.3 ? '#FF5C7A' : '#FFD23C'; c.fillRect(x - bw/2, by, bw * ratio, bh); // 血(低血变黄)
            }
        }
    }

    // 怪颜色按强度 tier 往红移（越硬越红，可读性）
    _tierColor(type, tier) {
        const base = ENEMY_COLORS[type] || '#fff';
        if (type === 'boss' || type === 'mini_boss') return base;
        // 基础色 → 高威胁红，线性插值
        const n = parseInt(base.slice(1), 16);
        const br = (n>>16)&255, bg = (n>>8)&255, bb = n&255;
        const r = Math.round(br + (220 - br) * tier);
        const g = Math.round(bg + (30 - bg) * tier);
        const b = Math.round(bb + (40 - bb) * tier);
        return `rgb(${r},${g},${b})`;
    }

    _bullets(c, w) {
        const col = weaponStat(w.state.weaponLevel).color;
        for (const b of w.bullets) {
            const x = this.tx(b.x), y = this.ty(b.y);
            // 拖尾沿飞行方向（飞向目标怪/门），而非固定竖直——与"自动弹幕"一致
            const dx = this.tx(b.tx) - x, dy = this.ty(b.ty) - y;
            const d = Math.hypot(dx, dy) || 1;
            const len = (b.weak ? 1.8 : 3) * b.width;
            const tailX = x - dx / d * len, tailY = y - dy / d * len;
            c.globalAlpha = b.weak ? 0.4 : 1;
            c.strokeStyle = col; c.lineWidth = b.width * (b.weak ? 0.55 : 1);
            c.beginPath(); c.moveTo(x, y); c.lineTo(tailX, tailY); c.stroke();
            c.globalAlpha = 1;
        }
    }

    _player(c, w) {
        const baseX = this.tx(w.playerX), baseY = this.ty(PLAYER_Y);
        const moving = w.isMoving;
        const col = moving ? '#2a7d72' : '#3DE0C8';
        const colDark = moving ? '#1d5c54' : '#2bb3a0';   // 腿/暗部
        // Count Masters 风一群小人：① 圆头+收窄身体+两条腿剪影(像人不像方块) ② 按屏幕 y 排序,
        // 后画(更靠下=更近)的盖住前面→重叠遮挡出"人多"密度 ③ 每人相位错开的 sin 上下颠+跑动摆腿→一团此起彼伏=活的。
        const layout = personLayout(w.state.personCount);
        // 计算每个小人屏幕位置 + 个体相位,按 py 升序排(先画上/远的,后画下/近的盖住)
        const dudes = layout.map((p, i) => {
            const phase = i * 1.7;                          // 个体相位错开(质数感间隔),群体此起彼伏
            const bob = Math.sin(this.t * 8 + phase) * 1.5 * p.scale;   // 上下颠
            return { px: baseX + p.dx, py: baseY - p.dy + bob, s: p.scale, phase };
        }).sort((a, b) => a.py - b.py);
        for (const d of dudes) this._drawDude(c, d.px, d.py, d.s, col, colDark, moving, d.phase);
        // 移动中显式提示"火力弱"
        if (moving) {
            c.fillStyle = 'rgba(255,180,60,0.9)'; c.textAlign = 'center'; c.textBaseline = 'bottom';
            c.font = 'bold 22px sans-serif'; c.fillText('移动中·火力弱', baseX, baseY - 60);
        }
    }

    // 画单个小人(Count Masters 剪影)：两条腿(跑动时左右摆) + 收窄身体 + 圆头。纯色填充,简洁。
    _drawDude(c, x, y, s, col, colDark, moving, phase) {
        const swing = moving ? Math.sin(this.t * 14 + phase) * 4 * s : 0;   // 跑动摆腿
        // 腿(两条,暗色,左右交替摆)
        c.strokeStyle = colDark; c.lineWidth = 3 * s; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x, y + 2 * s); c.lineTo(x - 4 * s + swing, y + 12 * s);
        c.moveTo(x, y + 2 * s); c.lineTo(x + 4 * s - swing, y + 12 * s);
        c.stroke();
        // 身体(上窄下宽的胶囊剪影)
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(x - 5 * s, y + 4 * s);
        c.lineTo(x - 3.5 * s, y - 6 * s);
        c.lineTo(x + 3.5 * s, y - 6 * s);
        c.lineTo(x + 5 * s, y + 4 * s);
        c.closePath(); c.fill();
        // 圆头
        c.beginPath(); c.arc(x, y - 10 * s, 5.5 * s, 0, Math.PI * 2); c.fill();
    }

    _hud(c, w) {
        // 顶部血条
        const ratio = w.state.hp / w.state.maxHp;
        c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(40, 30, 670, 28);
        c.fillStyle = ratio > 0.5 ? '#3ce05a' : ratio > 0.25 ? '#e0d23c' : '#e03c3c';
        c.fillRect(40, 30, 670 * ratio, 28);
        c.fillStyle = '#fff'; c.textAlign = 'left'; c.font = 'bold 22px sans-serif'; c.textBaseline = 'middle';
        c.fillText(`HP ${Math.ceil(w.state.hp)}`, 50, 44);
        // 关卡号醒目（大字，左上角血条下方）
        c.fillStyle = '#3DE0C8'; c.font = 'bold 30px sans-serif'; c.textBaseline = 'top';
        c.fillText(`第 ${w.state.level} 关 / 5`, 44, 70);
        // 武器名（非数字）+ 人数，右上角
        c.fillStyle = weaponStat(w.state.weaponLevel).color; c.textAlign = 'right'; c.font = 'bold 26px sans-serif';
        c.fillText(`${weaponName(w.state.weaponLevel)} ×${w.state.personCount}`, 706, 70);
        c.fillStyle = '#9fb'; c.font = '18px sans-serif';
        c.fillText(`分 ${w.state.score}`, 706, 102);
    }

    // helpers
    _roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r); c.closePath();
    }
    _poly(c, cx, cy, r, n) {
        c.beginPath();
        for (let i = 0; i <= n; i++) { const a = (Math.PI * 2 / n) * i - Math.PI / 2; const fx = cx + r * Math.cos(a), fy = cy + r * Math.sin(a); i ? c.lineTo(fx, fy) : c.moveTo(fx, fy); }
        c.closePath();
    }
    _hexA(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
    }
}
