// 游戏全局常量
// Cocos UI 坐标系：原点在屏幕中心，X ∈ [-375,375]，Y ∈ [-667,667]

// 两条 lane 的中心 X
export const LANE_LEFT_X  = -190;  // 左路：道具
export const LANE_RIGHT_X =  190;  // 右路：怪物
export const LANE_WIDTH   =  340;  // 每条 lane 宽度

// Y 边界
export const SCREEN_TOP    =  667;  // 屏幕顶部 Y
export const SCREEN_BOTTOM = -667;  // 屏幕底部 Y

// 玩家相关
export const PLAYER_Y         = -520;  // 玩家堆中心 Y
export const PLAYER_MOVE_SPEED =  600;  // 左右移动速度 px/s
// 硬边界：玩家 X 只能在左路中心到右路中心之间
export const PLAYER_MIN_X = LANE_LEFT_X;   // -190
export const PLAYER_MAX_X = LANE_RIGHT_X;  //  190

// 子弹
export const BULLET_SPEED = 1200;

// 固定射击间隔（秒/发）。靠武器伤害和人数区分强弱，射速恒定
export const SHOOT_INTERVAL = 0.12;

// 底线（怪物到达此 Y 触发扣血）
export const BASELINE_Y = -540;

// 武器等级定义
export enum WeaponLevel {
    PISTOL = 0,       // 手枪
    SMG = 1,          // 冲锋枪
    RIFLE = 2,        // 步枪
    MACHINE_GUN = 3,  // 机枪
    HEAVY_MG = 4,     // 重机枪
    LASER = 5,        // 激光武器
}

export const WEAPON_NAMES = ['手枪', '冲锋枪', '步枪', '机枪', '重机枪', '激光'];

// 每个武器等级的子弹伤害和粗细
export const WEAPON_STATS = [
    { damage: 1,  bulletWidth: 4,  color: '#FFE066' },  // 手枪
    { damage: 2,  bulletWidth: 6,  color: '#FFB830' },  // 冲锋枪
    { damage: 4,  bulletWidth: 8,  color: '#FF8C00' },  // 步枪
    { damage: 8,  bulletWidth: 12, color: '#FF5500' },  // 机枪
    { damage: 16, bulletWidth: 16, color: '#FF2200' },  // 重机枪
    { damage: 50, bulletWidth: 20, color: '#00FFFF' },  // 激光
];

// 道具门类型
export enum GateType {
    WEAPON_UP = 'weapon_up',   // 武器升级
    PERSON_UP = 'person_up',   // 增加小人
    HEAL = 'heal',             // 补血
}

// 怪物类型
export enum EnemyType {
    GRUNT = 'grunt',
    RUNNER = 'runner',
    BRUTE = 'brute',
    MINI_BOSS = 'mini_boss',
    BOSS = 'boss',
}

// 事件名（统一常量，避免生产/消费端拼写不一致导致断链）
export const EVT = {
    PLAYER_HIT:      'player_hit',
    ENEMY_KILLED:    'enemy_killed',
    GATE_CLEARED:    'gate_cleared',
    WAVE_START:      'wave_start',
    WAVE_BOSS_START: 'wave_boss_start',
    GAME_OVER:       'game_over',
    SCORE_CHANGE:    'score_change',
    HEAL_DROP:       'heal_drop',        // Enemy(Boss)死亡 → GateLane 在右路生成补血水晶
    GATE_LANE_INIT:  'gate_lane_init',   // LevelManager → GateLane 初始化传送带
    LEVEL_WAVES_START: 'level_waves_start', // LevelManager → WaveManager 开始出怪
};
