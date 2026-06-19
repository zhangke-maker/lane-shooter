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

// 怪类型 → 立绘资源 key
const ENEMY_TEX = {
    grunt: 'enemy_grunt', runner: 'enemy_runner', brute: 'enemy_brute',
    mini_boss: 'enemy_miniboss', boss: 'enemy_boss',
};
// 武器档(0~5) → 门内武器图标 key（0手枪无门图标，门只显示可升到的1~5档）
const WEAPON_TEX = [null, 'weapon_smg', 'weapon_rifle', 'weapon_mg', 'weapon_hmg', 'weapon_laser'];

// 美术资源清单：key → 路径（根相对，页面在 /web/ 下，素材在项目根 /assets/）
const TEX_PATHS = {
    player:      '/assets/textures/characters/player.png',
    enemy_grunt: '/assets/textures/enemies/enemy_grunt.png',
    enemy_runner:'/assets/textures/enemies/enemy_runner.png',
    enemy_brute: '/assets/textures/enemies/enemy_brute.png',
    enemy_miniboss:'/assets/textures/enemies/enemy_miniboss.png',
    enemy_boss:  '/assets/textures/enemies/enemy_boss.png',
    gate_crystal:'/assets/textures/gates/gate_crystal.png',
    weapon_smg:  '/assets/textures/gates/weapon_smg.png',
    weapon_rifle:'/assets/textures/gates/weapon_rifle.png',
    weapon_mg:   '/assets/textures/gates/weapon_mg.png',
    weapon_hmg:  '/assets/textures/gates/weapon_hmg.png',
    weapon_laser:'/assets/textures/gates/weapon_laser.png',
    death_big:   '/assets/textures/vfx/death_big.png',
    death_small: '/assets/textures/vfx/death_small.png',
    crystal_explosion:'/assets/textures/vfx/crystal_explosion.png',
    bg_tiles:    '/assets/textures/background/bg_tiles.png',
};

export class Renderer {
    constructor(canvas) {
        this.cv = canvas;
        this.ctx = canvas.getContext('2d');
        // canvas 像素尺寸固定 750×1334，CSS 缩放
        this.cv.width = 750; this.cv.height = 1334;
        this.scale = 1;
        // 异步加载所有美术资源；未加载完前对应绘制回退到色块
        this.tex = {};
        this.texReady = false;
        this._loadTextures();
        this.reset();
    }

    _loadTextures() {
        const keys = Object.keys(TEX_PATHS);
        let left = keys.length;
        for (const k of keys) {
            const img = new Image();
            img.onload = () => { this.tex[k] = img; if (--left === 0) this.texReady = true; };
            img.onerror = () => { console.error('素材加载失败:', TEX_PATHS[k]); if (--left === 0) this.texReady = true; };
            img.src = TEX_PATHS[k];
        }
    }

    // 把图按"目标显示直径 dia"居中画在 (x,y)，保持原图宽高比。flipX 水平翻转。
    _img(c, key, x, y, dia, opt = {}) {
        const img = this.tex[key];
        if (!img) return false;
        const ar = img.width / img.height;
        let w, h;
        if (ar >= 1) { w = dia; h = dia / ar; } else { h = dia; w = dia * ar; }
        c.save();
        c.translate(x, y);
        if (opt.flipX) c.scale(-1, 1);
        if (opt.alpha != null) c.globalAlpha = opt.alpha;
        c.drawImage(img, -w / 2, -h / 2, w, h);
        c.restore();
        return true;
    }

    // juice 状态：震屏强度、受伤闪红、击杀火花、升级弹字
    reset() {
        this.shake = 0;          // 屏幕震动强度（衰减）
        this.hurtFlash = 0;      // 受伤红闪（0~1 衰减）
        this.sparks = [];        // 击杀火花 {x,y,life,col}
        this.deaths = [];        // 死亡特效 {x,y,life,tex,dia}（黑底发光图，Additive）
        this.pops = [];          // 升级弹字 {life,text,col}
        this.banner = null;      // 关卡横幅（大字居中，过关/进关用）
        this._lastHp = Infinity; // 上帧HP（判掉血→红闪）；Infinity 使新局首次受伤必触发
        this.t = 0;
    }

    // 消费 world 事件做反馈（juice 必须外显，否则是 fake difficulty）
    consume(events) {
        for (const e of events) {
            if (e.kind === 'enemy_killed') {
                // 死亡特效（黑底发光图，Additive）：大怪 death_big，杂兵 death_small。
                // 画在怪【真实死亡坐标】(事件带 x/y)——即兵线处，随 DPS 强弱前后移动，不固定。
                const big = e.cfg.type === 'brute' || e.cfg.type === 'mini_boss' || e.cfg.type === 'boss';
                this.deaths.push({
                    x: e.x + (Math.random()-0.5)*20, y: e.y + (Math.random()-0.5)*20,
                    life: 1, tex: big ? 'death_big' : 'death_small', dia: (big ? e.cfg.radius*7 : e.cfg.radius*5),
                });
                // 击杀火花：在怪死亡位置出几粒
                for (let i = 0; i < 5; i++)
                    this.sparks.push({ x: e.x + (Math.random()-0.5)*40, y: e.y + (Math.random()-0.5)*40,
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
        // 死亡特效（黑底发光图 → Additive 混合，黑色自动消失，发光叠加）
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (const d of this.deaths) {
            const x = this.tx(d.x), y = this.ty(d.y);
            const grow = 1 + (1 - d.life) * 0.6;   // 略微扩张
            c.globalAlpha = Math.max(0, d.life);
            this._img(c, d.tex, x, y, d.dia * grow);
            d.life -= 0.05;
        }
        c.restore();
        c.globalAlpha = 1;
        this.deaths = this.deaths.filter(d => d.life > 0);
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
        const bg = this.tex.bg_tiles;
        if (bg) {
            // 纵向无缝平铺滚动：按 750 宽缩放，纵向铺满 + 随时间向下滚动制造前进感
            const tileW = 750, tileH = 750 * bg.height / bg.width;
            const off = (this.t * 60) % tileH;   // 向下滚动偏移
            for (let y = -tileH + off; y < 1334; y += tileH) {
                c.drawImage(bg, 0, y, tileW, tileH);
            }
            // 压暗罩：背景偏亮会吃掉发光特效/子弹，压一层深色让前景跳出来（交接说明§五硬约束）
            c.fillStyle = 'rgba(8,10,18,0.42)'; c.fillRect(0, 0, 750, 1334);
        } else {
            c.fillStyle = '#0c0f16'; c.fillRect(0, 0, 750, 1334);
        }
        // 左右泳道着色（让玩家一眼看清两条道）
        const midX = this.tx(0);
        c.fillStyle = 'rgba(245,166,35,0.06)'; c.fillRect(0, 0, midX, 1334);
        c.fillStyle = 'rgba(229,72,77,0.07)';  c.fillRect(midX, 0, 750 - midX, 1334);
        // 三道立体砖墙：左外墙 + 中央隔墙 + 右外墙（把屏幕围成两条被墙夹住的泳道）
        this._wall(c, 0, 26, false);          // 左外墙（亮面朝右）
        this._wall(c, midX - 18, 36, true);   // 中央隔墙（双面，较厚）
        this._wall(c, 750 - 26, 26, false, true); // 右外墙（亮面朝左，镜像）
        // 掉血线不绘制(用户要求隐藏)。判定仍按 BASELINE_Y 生效。
    }

    // 画一道竖直立体砖墙：x=左缘, ww=宽, divider=是否中央隔墙(双面立体), flip=镜像(右外墙)
    _wall(c, x, ww, divider, flip = false) {
        c.save();
        // 墙体渐变（亮面→暗面，营造圆柱/砖墙立体感）
        const g = c.createLinearGradient(x, 0, x + ww, 0);
        if (divider) {            // 中央隔墙：两侧暗、中间亮（双面受光）
            g.addColorStop(0, '#2a2620'); g.addColorStop(0.5, '#6b5d44');
            g.addColorStop(1, '#2a2620');
        } else if (flip) {        // 右外墙：左亮右暗
            g.addColorStop(0, '#6b5d44'); g.addColorStop(1, '#2a2620');
        } else {                  // 左外墙：左暗右亮
            g.addColorStop(0, '#2a2620'); g.addColorStop(1, '#6b5d44');
        }
        c.fillStyle = g; c.fillRect(x, 0, ww, 1334);
        // 顶部高光棱线
        c.fillStyle = 'rgba(255,240,200,0.25)';
        c.fillRect(x + (divider ? ww/2 - 1.5 : flip ? 1 : ww - 3), 0, 3, 1334);
        // 砖缝横纹（每 56px 一道暗缝，砖墙质感）
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2;
        for (let y = (this.t * 60) % 56; y < 1334; y += 56) {   // 随背景一起向下滚
            c.beginPath(); c.moveTo(x, y); c.lineTo(x + ww, y); c.stroke();
        }
        // 内外缘暗描边（让墙与泳道分明）
        c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1.5;
        c.strokeRect(x + 0.5, 0, ww - 1, 1334);
        c.restore();
    }
    // 注：掉血线(BASELINE_Y)不再绘制(用户要求隐藏)——判定仍生效,只是视觉不画。

    _gates(c, w) {
        for (const g of w.gates) {
            const x = this.tx(g.x), y = this.ty(g.y);
            const active = g.slot === 0;   // 只有 slot0(玩家正在打的)是活跃门、显示血量
            const col = GATE_COLORS[g.type] || '#888';
            const prog = Math.max(0, Math.min(1, g.progress || 0));
            // 琥珀壳立绘(横置 1769x889 ≈ 2:1)。塞满左路宽度(~320)。
            const shellW = 320, shellH = shellW * 889 / 1769;
            const crystal = this.tex.gate_crystal;
            if (crystal) {
                c.save(); c.globalAlpha = active ? 1 : 0.62;   // 非活跃门变暗
                c.drawImage(crystal, x - shellW / 2, y - shellH / 2, shellW, shellH);
                c.restore();
            } else {
                c.fillStyle = this._hexA(col, active ? 0.25 : 0.12);
                this._roundRect(c, x - shellW/2, y - shellH/2, shellW, shellH, 12); c.fill();
            }
            // 中央内含物：武器门=武器图标；加人门=缩小主角立绘（相对水晶更小，留出琥珀边框）
            const innerDia = shellH * 0.5;
            if (g.type === 'weapon_up') {
                // 门显示"再升一级会变成的武器"图标(当前等级+1，封顶激光5)
                const nextLv = Math.min(w.state.weaponLevel + 1, 5);
                this._img(c, WEAPON_TEX[nextLv] || 'weapon_smg', x, y - shellH * 0.06, innerDia, { alpha: active ? 1 : 0.7 });
            } else if (g.type === 'person_up') {
                this._img(c, 'player', x, y - shellH * 0.06, innerDia * 0.92, { alpha: active ? 1 : 0.7 });
            }
            // 封印高光（橙黄半透明罩 + 顶部一道高光，模拟"封在琥珀里"）
            c.save();
            c.globalAlpha = active ? 0.18 : 0.1;
            c.fillStyle = '#F5A623';
            this._roundRect(c, x - shellW * 0.42, y - shellH * 0.36, shellW * 0.84, shellH * 0.72, 10); c.fill();
            c.restore();
            // 标签 + 数量（加人门动态算：打穿前人数 = 当前 × 2^(更靠前加人门数)）。放琥珀壳下方，不压图标。
            const label = g.type === 'weapon_up'
                ? weaponName(Math.min(w.state.weaponLevel + 1, 5))
                : (() => { let ahead = 0; for (const o of w.gates) if (o.type === 'person_up' && o.slot < g.slot) ahead++;
                           return `+${w.state.personCount * Math.pow(2, ahead)} 人`; })();
            const ly = y + shellH * 0.5 + 4;
            c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.lineWidth = 5;
            c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 26px sans-serif';
            c.strokeText(label, x, ly); c.fillText(label, x, ly);
            // 活跃门血条/裂纹：上方进度条(打穿进度)
            if (active) {
                const bw = shellW * 0.8, bh = 7, by = y - shellH / 2 - 14;
                c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x - bw/2 - 1, by - 1, bw + 2, bh + 2);
                c.fillStyle = 'rgba(40,40,40,0.9)'; c.fillRect(x - bw/2, by, bw, bh);
                c.fillStyle = col; c.fillRect(x - bw/2, by, bw * prog, bh);
            }
        }
    }

    _enemies(c, w) {
        // z-order：全按屏幕 y 升序画——上方(远)先画、下方(近)后画盖住，符合"近的在前遮远的"俯视透视。
        // Boss 也按 y 正常参与遮挡(不再强制最上层,否则远处 Boss 会飘在近处小怪上=透视错)。
        // Boss 血条单独提到最上层画(见下方 bossBars)，保证关底目标血量始终可见。
        const ordered = [...w.enemies].sort((a, b) => this.ty(a.y) - this.ty(b.y));
        const bossBars = [];   // 收集 Boss 血条，循环后统一画在最上层
        // 红框(右路可用区)屏幕像素范围：中墙右缘 393 ~ 右墙左缘 724。
        // 怪的边界 clamp 放在 render 层(单一真相源)——只有这里知道每个怪的真实显示宽，
        // 才能按真实视觉半宽 inset，让立绘边缘不越红框(core 猜尺寸会错位=之前的 bug)。
        const BOX_L = 393, BOX_R = 724;
        for (const e of ordered) {
            // 视觉分级：怪越硬(maxHp 越高)→越大。强度一眼可辨(业界可读性标准)。
            // tier 0~1：按 maxHp 对数分级（怪海里 hp 跨度大，用 log 压缩）
            const tier = Math.max(0, Math.min(1, Math.log2(Math.max(1, e.maxHp)) / 7));  // hp 1~128 → 0~1
            const dia = e.cfg.radius * (1 + tier * 0.8) * 2 * 3.2;   // 显示直径
            const visHalf = dia * 0.30;   // 立绘留白，身体实际视觉半宽≈直径×0.30
            const y = this.ty(e.y);
            // x 按真实视觉半宽 clamp 进红框，立绘边缘不越界
            const x = Math.max(BOX_L + visHalf, Math.min(BOX_R - visHalf, this.tx(e.x)));
            const r = e.cfg.radius * (1 + tier * 0.8);
            // 行走蠕动动效(纯代码不画帧)：每只按 id 错开相位，叠加 摇摆+上下颠+倾斜，像一群活物往前涌。
            // 大怪(boss/miniboss)动得慢而沉，小怪动得快而碎。
            const img = this.tex[ENEMY_TEX[e.cfg.type]];
            if (img) {
                const ph = e.id * 1.3;                       // 个体相位错开
                const slow = (e.cfg.type === 'boss' || e.cfg.type === 'mini_boss') ? 0.55 : 1;
                const sway = Math.sin(this.t * 7 * slow + ph) * dia * 0.04;        // 左右晃
                const bob  = Math.abs(Math.sin(this.t * 9 * slow + ph)) * dia * 0.05; // 迈步上下颠(abs=只往上颠)
                const rock = Math.sin(this.t * 7 * slow + ph) * 0.09;             // 身体左右倾(弧度)
                const ar = img.width / img.height;
                const w2 = ar >= 1 ? dia : dia * ar, h2 = ar >= 1 ? dia / ar : dia;
                c.save();
                c.translate(x + sway, y - bob);
                c.rotate(rock);
                c.drawImage(img, -w2 / 2, -h2 / 2, w2, h2);
                c.restore();
            } else {   // 立绘没加载完，回退色块
                c.fillStyle = this._tierColor(e.cfg.type, tier);
                c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
            }
            // Boss 血条：先收集，循环后统一画在最上层(身体参与遮挡但血条始终可见)。
            // isWaveBoss=本关关底 Boss(与类型无关——L1/L2 的 BRUTE Boss 也有,普通 brute 小怪没有)。
            if (e.isWaveBoss) {
                bossBars.push({ x, by: y - r - 18, bw: Math.max(r * 2.4, 90), ratio: Math.max(0, e.hp / e.maxHp) });
            }
        }
        // Boss 血条统一画在所有怪之上(身体被正常遮挡,但血条始终可见——关底目标可读性)
        const bh = 8;
        for (const b of bossBars) {
            c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(b.x - b.bw/2 - 1, b.by - 1, b.bw + 2, bh + 2);   // 黑边底
            c.fillStyle = 'rgba(60,15,15,0.9)'; c.fillRect(b.x - b.bw/2, b.by, b.bw, bh);                  // 空槽
            c.fillStyle = b.ratio > 0.3 ? '#FF5C7A' : '#FFD23C'; c.fillRect(b.x - b.bw/2, b.by, b.bw * b.ratio, bh); // 血(低血变黄)
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
        c.save();
        c.globalCompositeOperation = 'lighter';   // 子弹发光叠加，在暗背景上跳出来
        for (const b of w.bullets) {
            const x = this.tx(b.x), y = this.ty(b.y);
            // 拖尾沿飞行方向（飞向目标怪/门），而非固定竖直——与"自动弹幕"一致
            const dx = this.tx(b.tx) - x, dy = this.ty(b.ty) - y;
            const d = Math.hypot(dx, dy) || 1;
            const len = (b.weak ? 2.2 : 4) * b.width;
            const tailX = x - dx / d * len, tailY = y - dy / d * len;
            const lw = b.width * (b.weak ? 0.6 : 1.1);
            c.globalAlpha = b.weak ? 0.45 : 1;
            // 外层光晕
            c.strokeStyle = col; c.lineCap = 'round';
            c.lineWidth = lw * 2.4; c.globalAlpha *= 0.35;
            c.beginPath(); c.moveTo(x, y); c.lineTo(tailX, tailY); c.stroke();
            // 内核
            c.globalAlpha = b.weak ? 0.6 : 1;
            c.lineWidth = lw;
            c.beginPath(); c.moveTo(x, y); c.lineTo(tailX, tailY); c.stroke();
            // 弹头亮点
            c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, lw * 0.6, 0, Math.PI*2); c.fill();
        }
        c.restore();
        c.globalAlpha = 1;
    }

    _player(c, w) {
        const baseX = this.tx(w.playerX), baseY = this.ty(PLAYER_Y);
        const moving = w.isMoving;
        // 一群小人(Count Masters 风)：① 按屏幕 y 排序,后画(更靠下=更近)的盖住前面→重叠出"人多"密度
        // ② 每人相位错开的 sin 上下颠→一团此起彼伏=活的 ③ idle 浮动/移动摆动全代码补间(美术只给静态立绘)。
        // 人数动态缩放：1 人时最大(170)，人多时缩小(底 90)，避免一堆大立绘糊成一片。
        const cnt = w.state.personCount;
        // 主角小队单体尺寸：固定(不缩),人多靠"人堆铺开"表现。单体 78px,人挨人能看清又够大。
        const groupDia = 78;
        const layout = personLayout(cnt);
        const dudes = layout.map((p, i) => {
            const phase = i * 1.7;                          // 个体相位错开(质数感间隔)
            const bob = Math.sin(this.t * 8 + phase) * 1.5 * p.scale;   // 上下颠
            return { px: baseX + p.dx, py: baseY - p.dy + bob, s: p.scale, phase };
        }).sort((a, b) => a.py - b.py);
        for (const d of dudes) this._drawDude(c, d.px, d.py, d.s * groupDia, moving, d.phase);
        // 移动中显式提示"火力弱"
        if (moving) {
            c.fillStyle = 'rgba(255,180,60,0.95)'; c.textAlign = 'center'; c.textBaseline = 'bottom';
            c.font = 'bold 22px sans-serif'; c.fillText('移动中·火力弱', baseX, baseY - groupDia * 0.7);
        }
    }

    // 画单个小人：真实 player 立绘(脚下加椭圆阴影让其"落地")。移动时轻微左右摆动(不旋转,避免朝向错觉)。
    _drawDude(c, x, y, dia, moving, phase) {
        // 脚下阴影(半透明椭圆,防浮空)
        c.save();
        c.fillStyle = 'rgba(0,0,0,0.28)';
        c.beginPath(); c.ellipse(x, y + dia * 0.42, dia * 0.30, dia * 0.10, 0, 0, Math.PI * 2); c.fill();
        c.restore();
        // 立绘(移动时整体轻微水平摆动模拟跑动,不旋转——旋转会让正面立绘显得歪/朝向怪)
        const img = this.tex.player;
        if (img) {
            const sway = moving ? Math.sin(this.t * 14 + phase) * 2.5 : 0;
            c.save();
            c.translate(x + sway, y);
            const ar = img.width / img.height;
            const w2 = ar >= 1 ? dia : dia * ar, h2 = ar >= 1 ? dia / ar : dia;
            c.drawImage(img, -w2 / 2, -h2 / 2, w2, h2);
            c.restore();
        } else {   // 回退色块
            c.fillStyle = moving ? '#2a7d72' : '#3DE0C8';
            c.beginPath(); c.arc(x, y, dia * 0.35, 0, Math.PI * 2); c.fill();
        }
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
