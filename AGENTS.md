# Elemental Overload (元素过载) — 2D 像素割草肉鸽

## 项目定位
Cocos Creator 3.8.6 + TypeScript 竖屏单指操作割草肉鸽。
核心玩法：自动施法序列 [油→火→雷→水] + 矩阵式元素反应 + 以撒式弹幕修改器。

## 目录结构

```
assets/Scripts/
├── Bullets/
│   ├── BaseBullet.ts          子弹基类（四叉树命中 + 修饰器链驱动 + tick 接口）
│   ├── OilBullet.ts           油弹（速度 250，碰撞半径 12，伤害 3）
│   ├── FireBullet.ts          火球（速度 400，碰撞半径 8，伤害 15）
│   ├── LightningBullet.ts     雷电弹（速度 500，碰撞半径 6，伤害 12）
│   └── WaterBullet.ts         水弹（速度 300，碰撞半径 10，伤害 5）
│
├── Core/
│   ├── ElementReactionHub.ts  反应矩阵（FIRE+OIL→2.0, LIGHTNING+WATER→1.5, LIGHTNING+OIL→1.0, GLUE+*→0.5）
│   ├── EventBus.ts            全局事件总线（on/off/emit，异常隔离）
│   ├── GameLoop.ts            唯一 update 发动机（P1玩家→P2子弹→P3敌人→P4波次→P5元素衰减）
│   ├── GameManager.ts         生命周期总控（onLoad 注册 → start 初始化系统）
│   ├── PoolManager.ts         全局对象池（spawn/despawn，严禁 destroy/instantiate）
│   └── Quadtree.ts            空间四叉树（替代 Physics2D 碰撞体）
│
├── Enemy/
│   ├── EnemyManager.ts        波次调度 + 敌人生成/回收 + 吸收盾/史莱姆检测
│   ├── EnemyStatusComponent.ts 元素状态容器（activeElements Map + 倒计时衰减 + tick 接口）
│   └── ReactionProcessor.ts   反应执行器（爆炸AOE/感电传导/引力黑洞/怪物融合）
│
└── Player/
    ├── BulletFactory.ts       子弹工厂（按元素类型取对应子弹池 + 修饰器注入）
    ├── BulletModifier.ts      修饰器基类 + Boomerang/Orbit + ModifierManager 链式容器
    ├── PlayerController.ts    单指拖拽移动（tick 接口，无 Cocos update）
    └── WeaponSystem.ts        自动施法队列（tick 接口，每 0.6s 发射）
```

## 核心架构决策（新会话必须遵守）

### 1. GameLoop 是唯一的 Cocos update
- 所有子系统**禁止使用 Cocos `update(dt)` 钩子**
- 必须暴露 `tick(dt)` 方法，由 `GameLoop.update()` 按优先级调用：
  - P1: PlayerController.tick
  - P2: BaseBullet.tick（遍历所有活跃子弹）
  - P3: EnemyManager.tick
  - P4: GameManager.tick
  - P5: EnemyStatusComponent.tick（遍历所有活跃敌人）

### 2. 两个致命性能坑（已落实）
- ❌ **Physics2D 碰撞体** → ✅ **Quadtree.query + Vec2.distance**
- ❌ **destroy/instantiate** → ✅ **PoolManager.spawn/despawn**

### 3. 初始化时序（已修复）
- `GameManager.onLoad()`：只做单例注册、波次配置、事件监听
- `GameManager.start()`：初始化所有核心系统（此时 PoolManager 等组件的 onLoad 已执行完毕）

### 4. 每文件一个 @ccclass
Cocos Creator 限制每个 .ts 文件只能有一个 @ccclass，所有子弹子类已拆分为独立文件。

### 5. 解耦方式
- 子弹→敌人：EventBus.emit(\"BULLET_HIT\", payload)
- 敌人→反应：EventBus.emit(\"REACTION:xxx\", payload)
- 反应→特效：EventBus.emit(\"VFX_xxx\", payload)

## 场景文件
- `assets/Scenes/MainScene.scene` — 主场景
- GameRoot 节点挂载：GameManager, GameLoop, PoolManager, EnemyManager, ReactionProcessor
- Player 节点挂载：PlayerController, WeaponSystem

## MCP 配置
- `.codex/mcp.json` — HTTP 直连 cocos-creator-mcp（端口 3000）
- 扩展路径：`extensions/cocos-creator-mcp/`

## 已知待办（按优先级）
1. 场景运行首测 — 在 Cocos Creator 中打开 MainScene.scene，点击预览，观察控制台输出
2. 创建 Player 和敌人的 Sprite 预制体（目前只有空节点）
3. 实现 BulletFactory 中对象池的 Prefab 注册（目前用空节点）
4. 实现 VFX 特效系统（监听 VFX_* 事件）
5. 实现 EnvironmentManager（油洼、积水区）
6. 实现肉鸽修改器奖励系统（波次结束选择 Modifier）
7. 实现 UI 系统（波次显示、计时器、GameOver 面板）

## 反应矩阵
| 元素组合 | 反应名 | 伤害倍率 | 效果 |
|---------|--------|---------|------|
| FIRE + OIL | FIRE_EXPLOSION | 2.0 | 半径 150 AOE |
| LIGHTNING + WATER | LIGHTNING_CONDUCT | 1.5 | 传导 5 目标 + 麻痹 2s |
| LIGHTNING + OIL | MAGNETIC_PULL | 1.0 | 引力黑洞拉扯 |
| GLUE + 任意 | MONSTER_MERGE | 0.5 | 属性叠加融合 |
