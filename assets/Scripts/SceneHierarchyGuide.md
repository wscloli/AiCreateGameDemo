/**
 * SceneHierarchyGuide.md
 *
 * Cocos Creator 编辑器场景节点层级树挂载指南
 *
 * ────────────────────────────────────────────────────────────
 *  场景节点层级树（Hierarchy）
 * ────────────────────────────────────────────────────────────
 *
 * GameRoot (空节点, position: 0,0,0)
 * │
 * ├── GameManager (空节点, 常驻)
 * │   ├── 组件: GameManager
 * │   │     worldWidth: 1200
 * │   │     worldHeight: 800
 * │   │     quadtreeMaxEntities: 8
 * │   │     quadtreeMaxDepth: 8
 * │   │
 * │   ├── 组件: GameLoop
 * │   │     playerNodePath: "GameRoot/Player"
 * │   │     enableDebugLog: true
 * │   │     debugLogInterval: 60
 * │   │
 * │   ├── 组件: PoolManager        ← 自动挂载
 * │   ├── 组件: EnemyManager       ← 自动挂载
 * │   └── 组件: ReactionProcessor  ← 自动挂载
 * │
 * ├── Player (Sprite 节点)
 * │   ├── 组件: Sprite (设置玩家贴图)
 * │   ├── 组件: PlayerController
 * │   │     moveSpeed: 250
 * │   │
 * │   └── 组件: WeaponSystem
 * │         baseFireInterval: 0.6
 * │         baseDamage: 10
 * │         baseSpeed: 350
 * │         bulletLifetime: 3.0
 * │
 * ├── UI (Canvas 节点)
 * │   ├── 组件: Canvas
 * │   ├── 组件: Widget (对齐屏幕)
 * │   │
 * │   ├── WaveLabel (Text)
 * │   │     string: "Wave 1"
 * │   │
 * │   ├── TimerLabel (Text)
 * │   │     string: "00:00"
 * │   │
 * │   └── GameOverPanel (空节点, 初始隐藏)
 * │       ├── GameOverLabel (Text)
 * │       └── RestartButton (Button)
 * │
 * └── Environment (空节点)
 *     ├── 组件: EnvironmentManager  (预留)
 *     │
 *     ├── OilPuddleContainer        (油洼容器, 预留)
 *     └── WaterPoolContainer        (积水区容器, 预留)
 *
 * ────────────────────────────────────────────────────────────
 *  场景设置
 * ────────────────────────────────────────────────────────────
 *
 * Canvas:
 *   - DesignResolution: 750 x 1334 (竖屏)
 *   - FitWidth: true
 *   - FitHeight: true
 *
 * Main Camera:
 *   - Position: (0, 0, 0)
 *   - Size: 400 (适配竖屏)
 *   - ClearColor: #1a1a2e (深色背景)
 *
 * ────────────────────────────────────────────────────────────
 *  初始化流程（自动，无需手动操作）
 * ────────────────────────────────────────────────────────────
 *
 * 1. Cocos 引擎加载场景
 * 2. GameManager.onLoad() 触发
 *    ├─ 注册为常驻节点
 *    ├─ 获取 GameLoop 引用
 *    ├─ 初始化波次配置表
 *    ├─ ElementReactionHub.init()       ← 注册反应矩阵
 *    ├─ new Quadtree()                  ← 创建四叉树
 *    ├─ 挂载 PoolManager               ← 对象池
 *    ├─ BulletFactory.init(quadtree)    ← 注册 4 种子弹池
 *    ├─ EnemyManager.init(quadtree)     ← 注入四叉树
 *    └─ 挂载 ReactionProcessor          ← 注册反应监听
 *
 * 3. 外部调用 GameManager.instance.startGame()
 *    ├─ GameLoop.startLoop()            ← 启动主循环
 *    └─ GameManager.startWave(1)        ← 开始第 1 波
 *
 * 4. GameLoop.update(dt) 开始每帧驱动：
 *    P1: PlayerController.tick          ← 位移 + 武器
 *    P2: BaseBullet.tick (遍历所有)     ← 运动 + 碰撞
 *    P3: EnemyManager.tick              ← 四叉树同步
 *    P4: GameManager.tick               ← 波次生成
 *    P5: EnemyStatusComponent.tick      ← 元素衰减
 *
 * ────────────────────────────────────────────────────────────
 *  注意事项
 * ────────────────────────────────────────────────────────────
 *
 * 1. GameManager 节点必须标记为常驻（代码中已自动处理）
 * 2. Player 节点路径必须与 GameLoop.playerNodePath 一致
 * 3. 所有子系统已移除 Cocos update，仅靠 GameLoop 驱动
 * 4. 子弹和敌人的 Prefab 需挂载对应组件后注册到 PoolManager
 * 5. 如需添加新的每帧逻辑，必须在 GameLoop 中注册，严禁另起 update
 */
