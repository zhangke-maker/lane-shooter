# 双路防线 (Lane Shooter)

> ⚠️ **开发中（Work In Progress）** — 当前仅完成阶段 1–2（纯逻辑核心 + 无头模拟验证 + 网页可玩原型）。
> **这是开发过程版本，不是可玩的正式版（V1.0）。** Cocos 渲染层接入、美术资源、微信小游戏发布链路尚未完成。

一款竖屏「双路射击」技巧小游戏的开发仓库，目标平台为微信小游戏。

## 核心玩法

玩家左右滑动控制角色，在两条路之间做**时间取舍**：

- **右路打怪**：角色自动向上射击，守住潮水般涌下的敌人，漏怪会掉血。
- **左路刷道具**：去左路打掉道具门，升级武器 / 加人 / 回血，但离开右路就会漏怪。

技巧落在「何时去左路刷哪个道具、怎么搭配成长」的决策上（走位 + 构筑），而非操作精度——契合触摸平台。一条命连续闯 5 关、能力跨关累积、不能选关、死了回第 1 关。难度上限固定递增、形态每局随机（破解唯一最优解）。

## 架构

逻辑与渲染分离，纯逻辑核心零引擎依赖，可用 Node 直接跑无头模拟验证（业界标准：headless deterministic core）。

```
assets/scripts/core/   纯 TS 逻辑核心（零 Cocos 依赖，Node 和 Cocos 共用同一份）
  types.ts    常量 / 数值 / 类型
  levels.ts   5 关配置：威胁曲线 + 道具 + Boss
  world.ts    GameWorld 确定性世界（step(dt,input)→事件，种子化随机，可 clone）
sim/                   Node 无头模拟（不依赖 Cocos）
  bots.ts     前瞻式玩家模型（递归 lookahead，分菜/中/强水平档）
  winrate.ts  通关率曲线统计（多水平 × 多随机种子）
  tune.ts     通关率驱动的难度调参器
  replay.ts   单局逐秒文字回放
web/                   网页可玩原型（Canvas，复用 core；web/lib 为构建产物）
assets/scripts/*.ts    旧 Cocos 渲染层脚本（尚未接入新 core）
```

## 运行

需要 Node 25+（原生跑 TS，无需 tsx/tsc）。

```bash
# 网页可玩原型
node sim/build-web.mjs      # 把纯 TS 核心构建成浏览器可用 JS
./sim/serve.sh              # 起本地服务器
# 浏览器打开 http://localhost:8088/web/index.html

# 无头模拟（验证难度）
./sim/run.sh winrate.ts 100   # 通关率曲线
./sim/run.sh replay.ts 1      # seed=1 逐秒回放
```

## 路线

- [x] 阶段 1：解耦纯逻辑核心 + 无头模拟验证体系
- [x] 阶段 2：难度调优（通关率验证 + 抗成长通胀）+ 移动损失外显 + 网页可玩原型
- [ ] 阶段 3：接回 Cocos 渲染层 + 重建场景
- [ ] 阶段 4：微信小游戏发布链路

## License

[MIT](LICENSE) © 2026 ZhangKe
