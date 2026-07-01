# Element Overload 项目踩坑记录

> 本文档记录 Cocos Creator 3.8.6 + TypeScript 项目开发中遇到的所有关键问题和解决方案。
> 新项目可直接参考，避免重复踩坑。

---

## 目录

- [0. 启动黑屏：Canvas 相机未正确渲染](#0-启动黑屏canvas-相机未正确渲染)
- [1. 渲染层：子弹/敌人完全看不见](#1-渲染层子弹敌人完全看不见)
- [2. 事件系统：EventBus 回调丢失 this](#2-事件系统eventbus-回调丢失-this)
- [3. GameLoop 架构：tick 驱动遗漏](#3-gameloop-架构tick-驱动遗漏)
- [4. 物理/碰撞：子弹自毁 + 敌人重叠](#4-物理碰撞子弹自毁--敌人重叠)
- [5. 坐标系：UI 坐标 vs Canvas 局部坐标](#5-坐标系ui-坐标-vs-canvas-局部坐标)
- [6. 边界限制：分辨率切换后出界](#6-边界限制分辨率切换后出界)
- [7. 对象池：节点层级决定可见性](#7-对象池节点层级决定可见性)
- [8. 性能优化：已落实的决策](#8-性能优化已落实的决策)

---

## 0. 启动黑屏：Canvas 相机未正确渲染

### 问题表现
点击预览后整个屏幕纯黑，没有任何内容显示。

### 根因分析
Cocos Creator 3.x 中 Canvas 组件会在 `start()` 阶段自动配置相机，某些设置会覆盖 Inspector 中的手动配置。常见原因：

| 问题 | 现象 | 修复 |
|------|------|------|
| `clearFlags` 未包含 COLOR | 屏幕不刷新，留下上一帧残影或纯黑 | `cam.clearFlags = 7`（COLOR \| DEPTH \| STENCIL） |
| `clearColor` 透明或纯黑 | 背景不可见 | `cam.clearColor = new Color(26, 26, 46, 255)` |
| `visibility` 不包含目标层 | 所有节点被相机忽略 | `cam.visibility = 0x7FFFFFFF`（所有层） |
| `projection` 不是 ORTHO | 2D UI 被透视裁剪 | `cam.projection = 1`（ORTHO） |
| 节点 layer 不是 UI_2D | 节点不被 UI 相机渲染 | `node.layer = 33554432` |

### 解决方案（BattleTestScaffold._fixCamera）
```typescript
private _fixCamera(canvas: Node): void {
    const canvasComp = canvas.getComponent(Canvas);
    if (!canvasComp) return;
    const cam = canvasComp.cameraComponent;
    if (!cam) return;

    // Canvas.start() 已运行，修复被覆盖的设置
    cam.clearFlags = 7;           // COLOR | DEPTH | STENCIL
    cam.clearColor = new Color(26, 26, 46, 255);
    cam.visibility = 0x7FFFFFFF;  // 所有层
    cam.projection = 1;           // ORTHO
    cam.orthoHeight = 400;
    cam.near = 1;
    cam.far = 2000;
}
```

### 经验总结
- 永远不要把希望寄托在 Inspector 里手动设置相机参数
- Canvas 的 `start()` 会覆盖部分设置，在 `BattleTestScaffold.start()` 里二次修复
- 黑屏时优先检查 `clearFlags` 和 `visibility` 两个参数

---

## 1. 渲染层：子弹/敌人完全看不见

### 问题表现
预览时玩家、敌人都可见，但子弹完全看不到，控制台没有报错。

### 根因分析（层层递进）

#### 1.1 子弹从未被创建 ❌
**原因**：`GameLoop.update()` P1 阶段只调用了 `PlayerController.tick()`，**没有调用 `WeaponSystem.tick()`**。

```typescript
// ❌ 错误：WeaponSystem.tick 完全缺失
gameLoop.update() → PlayerController.tick() → [停止]

// ✅ 修复后：
gameLoop.update() → PlayerController.tick()
                  → WeaponSystem.tick() → _fire() → BulletFactory.spawnBullet()
```

**解决方案**：在 `GameLoop` 解析玩家节点时同时获取 `WeaponSystem` 组件，并在 P1 阶段驱动：
```typescript
// GameLoop.ts
this._weaponSystem = playerNode.getComponent(WeaponSystem);
// ...
this._playerController?.tick(safeDt);
this._weaponSystem?.tick(safeDt);  // ← 新增
```

#### 1.2 lifetime 没有累加 ❌
**原因**：`BaseBullet.tick()` 中虽然检查了 `this.attr.lifetime >= this.maxLifetime`，但**从来没有执行 `this.attr.lifetime += dt`**。

```typescript
// ❌ 错误：lifetime 永远是 0
if (this.attr.lifetime >= this.maxLifetime) { // 0 >= 5.0 ?
    this._despawn(); // 第一帧就自毁
}

// ✅ 修复后：
this.attr.lifetime += dt; // ← 新增
if (this.attr.lifetime >= this.maxLifetime) {
    this._despawn();
}
```

#### 1.3 子弹命中自己 ❌
**原因**：`BaseBullet._checkHit()` 使用四叉树查询附近实体时，**没有排除自身**。由于子弹也在四叉树中注册，`dist = 0 <= radius + radius` 恒成立，导致子弹生成后第一帧就自毁。

```typescript
// ❌ 错误：没有排除自身
for (const candidate of candidates) {
    if (dist <= this.radius + candidate.radius) { // 会命中自己
        this._onHit(candidate);
    }
}

// ✅ 修复后：
for (const candidate of candidates) {
    if (candidate.id === this.id) continue; // ← 新增
    if (dist <= this.radius + candidate.radius) {
        this._onHit(candidate);
    }
}
```

#### 1.4 Sprite + SpriteFrame 纹理渲染不可靠 ❌
**原因**：尝试用 `Sprite` + 程序化生成的 `SpriteFrame`（`Texture2D.uploadData`）渲染子弹，但在不同分辨率/适配模式下，SpriteFrame 的 `rect` 和 `originalSize` 赋值方式（直接修改属性 vs 使用 `Rect`/`Size` 对象）会导致渲染异常。

**解决方案**：改为使用 **Graphics** 画圆，与 VFXManager 使用相同渲染方案：
```typescript
// ✅ 可靠方案：Graphics 画圆
const g = this.node.addComponent(Graphics);
g.fillColor = color;
g.circle(0, 0, 8);
g.fill();
```

同时确保添加 `UITransform` 组件，并将 `node.layer` 设置为 `UI_2D`（`33554432`）。

### 经验总结
| 症状 | 排查顺序 |
|------|----------|
| 完全看不见 | 1. 检查是否被创建（log）→ 2. 检查 lifetime → 3. 检查是否自命中 → 4. 检查渲染组件 |
| 一闪即逝 | 1. 检查 lifetime 累加 → 2. 检查碰撞排除自身 → 3. 检查超时回池 |
| 有节点但无像素 | 1. 检查 UITransform → 2. 检查 layer → 3. 改用 Graphics 替代 Sprite |

---

## 2. 事件系统：EventBus 回调丢失 this

### 问题表现
子弹命中敌人触发 `VFX_FIRE_IMPACT` 事件时崩溃：
```
TypeError: this._spawnVFX is not a function
```

### 根因分析
`EventBus.on()` 注册时传入了 `target`（用于 off 时精确移除），但 `EventBus.emit()` 调用回调时没有使用 `.call(target)` 绑定 `this`。

```typescript
// ❌ 错误：丢失 this
handler.callback(...args);

// ✅ 修复后：
if (handler.target) {
    handler.callback.call(handler.target, ...args);
} else {
    handler.callback(...args);
}
```

### 影响范围
此 bug 影响所有通过 EventBus 注册的事件回调，包括：
- `VFXManager`（VFX_EXPLOSION 等）
- `EnemyManager`（BULLET_HIT）
- `ReactionProcessor`（REACTION:* 事件）
- `GameLoop`（QUERY_PLAYER_POSITION）

### 经验总结
- 自定义事件总线必须实现 `callback.call(target, ...args)`
- 如果不传 target，箭头函数可以规避此问题，但会失去精确 off 的能力

---

## 3. GameLoop 架构：tick 驱动遗漏

### 问题表现
某子系统的逻辑完全不执行（如 WeaponSystem 不发射子弹）。

### 根因分析
项目采用 **"GameLoop 是唯一 update"** 架构：
- 所有子系统禁止挂载 Cocos `update(dt)`
- 必须暴露 `tick(dt)` 方法
- 由 `GameLoop.update()` 按优先级统一调用

如果某个子系统的 `tick()` 没有被 GameLoop 调用，整个子系统就完全停摆。

### GameLoop 驱动优先级（P1→P6）
```
P1: PlayerController.tick + WeaponSystem.tick
P2: 所有活跃子弹 BaseBullet.tick（四叉树查询 + 命中检测）
P3: EnemyManager.tick（同步四叉树位置）
P4: GameManager.tick（波次生成调度）
P5: 所有活跃敌人 EnemyStatusComponent.tick（元素衰减 + AI移动）
P6: VFXManager.tick（特效动画 + 回收）
```

### 经验总结
- 新增任何需要每帧更新的子系统时，**必须在 GameLoop 中注册 tick 调用**
- 不要在一个 tick 中重复调用另一个系统的 tick（如 PlayerController 内调用 WeaponSystem.tick，同时 GameLoop 也调用）

---

## 4. 物理/碰撞：子弹自毁 + 敌人重叠

### 4.1 子弹自毁
见 [1.3 子弹命中自己](#13-子弹命中自己)。

### 4.2 敌人重叠
**问题表现**：大量敌人从四周涌向玩家，叠成一团，无法区分个体。

**解决方案**：在 `EnemyStatusComponent._tickMoveToPlayer()` 中加入软碰撞排斥力：
```typescript
// 遍历所有其他敌人
for (const [id, other] of enemies) {
    if (id === this.enemyId) continue;
    
    const oDist = Math.sqrt(ox * ox + oy * oy);
    const minDist = myRadius + otherRadius;
    
    if (oDist < minDist) {
        const overlap = minDist - oDist;
        const force = (overlap / minDist) * 600; // 600 px/s 最大排斥速度
        vx -= (ox / oDist) * force;
        vy -= (oy / oDist) * force;
    }
}
```

**关键设计**：
- 使用**速度驱动**（vx/vy）而非位置偏移，与基础移动速度自然叠加
- 排斥力与重叠深度成正比（`overlap / minDist`），避免生硬弹开
- 通过 `scale` 动态调整碰撞半径

---

## 5. 坐标系：UI 坐标 vs Canvas 局部坐标

### 问题表现
角色拖拽移动时，手指和角色之间存在固定偏移，越往屏幕边缘偏移越大。

### 根因分析
Cocos Creator 3.x 中存在两个不同的坐标系：

| 坐标系 | 原点 | 获取方式 | 用途 |
|--------|------|----------|------|
| **UI 坐标** | 屏幕左上角 | `event.getUILocation()` | 触摸事件原始位置 |
| **Canvas 局部坐标** | Canvas 中心 | `node.position` | 节点在 Canvas 中的位置 |

错误地混用两者：
```typescript
// ❌ 错误：UI 坐标和 Canvas 坐标混用
const uiPos = event.getUILocation(); // 左上角原点
const pos = this.node.position;       // Canvas 中心原点
this._dragOffset.set(pos.x - uiPos.x, pos.y - uiPos.y, 0); // 坐标系不一致！
```

### 解决方案
新增 `_uiToCanvas()` 转换方法：
```typescript
private _uiToCanvas(uiPos: { x: number; y: number }): Vec3 {
    const canvasNode = this.node.scene?.getChildByName('Canvas');
    const uiTransform = canvasNode?.getComponent(UITransform);
    const designSize = uiTransform?.contentSize || screen.windowSize;
    return new Vec3(
        uiPos.x - designSize.width / 2,   // 减去半宽，将原点移到中心
        uiPos.y - designSize.height / 2,  // 减去半高
        0,
    );
}
```

所有触摸事件统一转换后再参与计算：
```typescript
const canvasPos = this._uiToCanvas(event.getUILocation());
this._dragOffset.set(pos.x - canvasPos.x, pos.y - canvasPos.y, 0);
```

### 经验总结
- **永远不要直接将 `getUILocation()` 与 `node.position` 混用**
- 涉及触摸交互时，第一时间统一坐标系
- Canvas 局部坐标系 = UI 坐标 - 设计分辨率半宽高

---

## 6. 边界限制：分辨率切换后出界

### 问题表现
使用固定 `worldWidth / worldHeight` 限制角色移动边界，切换分辨率后角色可以移出屏幕。

### 根因分析
固定边界（如 1200×800）与相机实际可视范围不匹配。切换分辨率后：
- 竖屏：可视区域变窄，固定边界太宽
- 横屏：可视区域变宽，固定边界太窄

### 解决方案
动态读取相机参数计算实际边界：
```typescript
private _getCameraBounds(): { halfW: number; halfH: number } {
    const canvas = this.node.scene?.getChildByName('Canvas')?.getComponent(Canvas);
    const cam = canvas?.cameraComponent;
    if (!cam) return { halfW: 1000, halfH: 1000 };

    const halfH = cam.orthoHeight;
    const size = screen.windowSize;
    const halfW = halfH * (size.width / size.height);
    return { halfW, halfH };
}
```

### 经验总结
- 移动边界必须与**相机实际可视范围**绑定，而非固定数值
- `cam.orthoHeight` 是垂直半高，水平半宽 = `orthoHeight * 宽高比`

---

## 7. 对象池：节点层级决定可见性

### 问题表现
对象池创建的节点有时可见，有时不可见。

### 根因分析
`PoolManager` 创建对象时，将节点挂在 `PoolManager` 自身的节点下：
```typescript
node.parent = this._nodeParent; // PoolManager 实例的节点
```

如果 `PoolManager` 节点不在 Canvas 层级下，UI 相机无法渲染其子节点。

### 解决方案
确保 PoolManager 挂载在 Canvas 下，或在生成后将节点 parent 改为 Canvas：
```typescript
// BattleTestScaffold.ts
const gameRoot = scene.getChildByName('GameRoot');
if (gameRoot && gameRoot.parent !== canvas) {
    gameRoot.parent = canvas; // 确保 GameRoot（含 PoolManager）在 Canvas 下
}
```

### 经验总结
- UI 相机只渲染 Canvas 层级下的节点
- 对象池的 parent 节点必须在 Canvas 下，否则 spawn 出来的对象不可见
- 使用 `node.layer = 33554432`（UI_2D）确保被 UI 相机渲染

---

## 8. 性能优化：已落实的决策

### 8.1 禁用 Physics2D
- ❌ `Physics2D` 碰撞体 → ✅ `Quadtree.query + Vec2.distance`
- 四叉树替代物理引擎，O(log n) 查询，无碰撞回调开销

### 8.2 对象池替代 instantiate/destroy
- ❌ `instantiate / destroy` → ✅ `PoolManager.spawn / despawn`
- 预生成 20 个子弹、30 个敌人，避免运行时 GC 卡顿

### 8.3 单一 update 发动机
- 所有子系统禁止挂载 Cocos `update()`
- `GameLoop.update()` 是唯一 update，按优先级驱动所有 tick
- 便于控制更新顺序（玩家 → 子弹 → 敌人 → 波次 → 元素衰减 → 特效）

### 8.4 事件总线解耦
- 子弹→敌人：`EventBus.emit("BULLET_HIT")`
- 敌人→反应：`EventBus.emit("REACTION:xxx")`
- 反应→特效：`EventBus.emit("VFX_xxx")`
- 零直接引用，模块可独立测试

---

## 快速诊断清单

| 症状 | 第一排查点 | 第二排查点 |
|------|-----------|-----------|
| 启动黑屏 | `clearFlags` 是否包含 COLOR | `visibility` 是否包含目标 layer |
| 子弹看不见 | `WeaponSystem.tick()` 是否被 GameLoop 调用 | `BaseBullet.init()` 是否执行 |
| 子弹一闪即逝 | `lifetime` 是否累加 | `_checkHit()` 是否排除自身 |
| VFX 报错 | EventBus 是否 `.call(target)` | VFXManager 是否挂载在 Canvas 下 |
| 拖拽偏移 | `_uiToCanvas()` 转换是否正确 | `_dragOffset` 计算坐标系是否一致 |
| 角色出界 | 边界是否动态读取相机 | `clampPosition` 是否在所有位置更新处调用 |
| 敌人重叠 | 排斥力公式是否正确 | 遍历范围是否包含所有活跃敌人 |
| 节点不可见 | parent 是否在 Canvas 下 | `layer` 是否设为 `UI_2D` |

---

*文档版本：2026-07-01*
*适用引擎：Cocos Creator 3.8.6*
*项目：Element Overload（2D 像素割草肉鸽）*
