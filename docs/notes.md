# Element Overload — 开发规范与踩坑速查

> Cocos Creator 3.8.6 + TypeScript。AI 生成代码前必读。

---

## 一、架构铁律（不可违反）

| # | 规则 | 违反后果 |
|---|------|---------|
| 1 | **GameLoop 是唯一 `update()`**。所有子系统禁止挂 `update(dt)`，必须暴露 `tick(dt)` 由 GameLoop 按优先级调用 | 重复驱动、时序错乱 |
| 2 | **禁止 `destroy/instantiate`**。统一用 `PoolManager.spawn/despawn` | 内存泄漏、GC 卡顿 |
| 3 | **禁止 Physics2D 碰撞体**。用 `Quadtree.query + Vec2.distance` | 性能暴跌 |
| 4 | **每个 .ts 文件只有一个 `@ccclass`** | Cocos 编译报错 |
| 5 | **对象池取出后必须手动 reset 状态** | 状态残留导致诡异 Bug |
| 6 | **子类禁止覆写父类核心生命周期方法**。用模板方法模式（固定骨架 + 钩子） | 框架逻辑被绕过 |

### GameLoop tick 优先级
```
P1: PlayerController.tick + WeaponSystem.tick
P2: 敌人移动 (EnemyStatusComponent.tick)
P3: EnemyManager.tick (重建四叉树)
P4: BaseBullet.tick (所有子弹类)
P5: GameManager.tick (波次)
P6: VFXManager.tick (特效)
P7: EnvironmentManager.tick (环境区)
```

---

## 二、渲染层规范

### 2.1 相机设置（代码里设，别信 Inspector）
```typescript
cam.clearFlags = 7;                    // COLOR | DEPTH | STENCIL
cam.clearColor = new Color(26,26,46,255);
cam.visibility = 0x7FFFFFFF;           // 所有层
cam.projection = 1;                    // ORTHO
cam.orthoHeight = 400;
```

### 2.2 节点可见性 checklist
- [ ] `node.layer = 33554432`（UI_2D）
- [ ] 节点挂在 Canvas 下（或 Canvas 的子节点下）
- [ ] Sprite 有 `spriteFrame` 且 `sizeMode = CUSTOM`
- [ ] 节点 `active = true`
- [ ] 节点 scale 不为 0
- [ ] 对象池取出后 `setPosition()` 到正确位置

### 2.3 Sprite 初始化顺序（Cocos 3.8 陷阱）
**必须先设 `sizeMode = CUSTOM`，再设 `spriteFrame`。**
如果顺序反过来，Cocos 会在赋值 `spriteFrame` 时自动把 `contentSize` 覆盖为纹理原始尺寸（如 64x64），导致你手动设置的 `setContentSize(48, 6)` 被覆盖，最终渲染成大方块。

```typescript
// ❌ 错：先 spriteFrame 再 sizeMode → contentSize 被覆盖为 64x64
sp.spriteFrame = EntityVisualFactory.getWhiteSpriteFrame();
sp.sizeMode = Sprite.SizeMode.CUSTOM;

// ✅ 对：先 sizeMode 再 spriteFrame → contentSize 保持手动值
sp.sizeMode = Sprite.SizeMode.CUSTOM;
sp.spriteFrame = EntityVisualFactory.getWhiteSpriteFrame();
```

### 2.4 SpriteFrame 初始化（代码生成纹理时）
直接用 `sf.rect.width = size` 赋值不会触发 Cocos 内部更新，必须走构造函数：

```typescript
// ❌ 错：直接赋值，渲染时可能取不到正确尺寸
sf.rect.width = size;
sf.rect.height = size;

// ✅ 对：用 Rect / Size / Vec2 构造函数初始化
sf.rect = new Rect(0, 0, size, size);
sf.originalSize = new Size(size, size);
sf.offset = new Vec2(0, 0);
```

> 缓存 key 加版本号前缀（如 `v2|...`），修改 SpriteFrame 初始化方式后确保旧缓存失效。

### 2.5 子弹/敌人颜色
子弹用 Sprite（非 Graphics），颜色通过 `Sprite.color` 设置：
```typescript
const ELEMENT_COLORS: Record<ElementType, Color> = {
    [ElementType.NONE]: new Color(200,200,200,255),
    [ElementType.OIL]: new Color(180,120,40,255),
    [ElementType.FIRE]: new Color(255,80,20,255),
    [ElementType.LIGHTNING]: new Color(100,200,255,255),
    [ElementType.WATER]: new Color(50,150,255,255),
    [ElementType.GLUE]: new Color(200,80,255,255),
};
```

---

## 三、对象池规范

### 3.1 注册与预生成
```typescript
// 在 GameManager.start() 时注册
PoolManager.registerPool(BulletClass, 0);

// 模板节点注入后再 prewarm
PoolManager.setTemplateNode(BulletClass, templateNode);
PoolManager.prewarm(BulletClass, 20);
```

### 3.2 回收时必须 reset 的状态清单

| 状态类型 | 示例 | reset 位置 |
|---------|------|-----------|
| 基本类型 | `_phase`, `_timer` | `_despawn()` 或修饰器 `reset()` |
| Set/Map | `_hitEnemyIds`, `activeElements` | 同上，必须 `.clear()` |
| 节点属性 | `scale`, `rotation` | `init()` 开头重置 |
| 组件引用 | `_ai`, `_target` | `init()` 开头置 null |

### 3.3 典型错误
```typescript
// ❌ 错：回收时不 reset 修饰器状态
PoolManager.despawn(bullet);

// ✅ 对：_despawn() 里显式 reset
protected _despawn(): void {
    const boomerang = this.modifierManager.get<BoomerangModifier>('Boomerang');
    if (boomerang) boomerang.reset(); // 必须！
    this.modifierManager.clear();
    this.attr.customData.clear();
    PoolManager.despawn(this);
}
```

---

## 四、事件系统（EventBus）

### 4.1 基本用法
```typescript
// 监听（必须传 this，否则 off 不掉）
EventBus.on('EVENT_NAME', this._handler, this);

// 派发
EventBus.emit('EVENT_NAME', payload);

// 销毁时注销（必须成对）
EventBus.off('EVENT_NAME', this._handler, this);
```

### 4.2 常用事件清单
```
BULLET_HIT          → EnemyManager 处理伤害
REACTION:xxx        → ReactionProcessor 处理元素反应
VFX_xxx             → VFXManager 绘制特效
ELEMENT_APPLIED     → 敌人被附加元素
ENEMY_RESISTED      → Tank 减伤提示
ENEMY_DIED          → 敌人死亡
WAVE_COMPLETE       → RoguelikeRewardSystem 弹出三选一
REWARD_SHOW         → RewardSelectionPanel 显示面板
GAME_PAUSE / RESUME → GameLoop 暂停/恢复
QUERY_PLAYER_POSITION → 返回玩家 Vec3
QUERY_ENEMY_POSITIONS → 返回敌人坐标数组
```

---

## 五、坐标系与输入

### 5.1 坐标系规则
- 所有游戏逻辑用 **Canvas 局部坐标**（原点在屏幕中心）
- 输入事件（Touch/Mouse）返回的是 **屏幕坐标**，必须转换：
```typescript
// PlayerController 里的正确做法
private _screenToWorld(screenPos: {x:number, y:number}): Vec3 {
    const cam = this._getCamera();
    return cam.screenToWorld(new Vec3(screenPos.x, screenPos.y, 0));
}
```

### 5.2 拖拽移动公式
```typescript
// 1. 屏幕坐标 → 世界坐标
const worldPos = cam.screenToWorld(new Vec3(touchX, touchY, 0));

// 2. 世界坐标 → Canvas 局部坐标
const localPos = canvasNode.uiTransform.convertToNodeSpaceAR(worldPos);

// 3. 限制在屏幕边界内
const clamped = this._clampPosition(localPos);
playerNode.setPosition(clamped);
```

### 5.3 桌面浏览器输入
桌面环境没有 TOUCH_END，必须同时监听 MOUSE_UP：
```typescript
node.on(Node.EventType.TOUCH_END, this._onGlobalTouchEnd, this);
input.on(Input.EventType.MOUSE_UP, this._onGlobalMouseUp, this);
```

### 5.4 动态 UI 节点触摸处理最佳实践（重要教训）

2026-07-24 修复 `RewardSelectionPanel` 点击失效时总结：

#### 问题现象
- 奖励选择面板显示正常，但卡片和确定按钮完全无法点击。
- 卡片/按钮使用 `card.on(Node.EventType.TOUCH_END)` 注册节点级事件，但点击后回调不被触发。
- 改用全局 `input.on(Input.EventType.TOUCH_END)` 后回调能收到，但命中检测始终失败。

#### 根因
1. **节点级 UI 事件对动态创建节点不可靠**：Cocos UI 事件分发依赖 `UITransform`、层级、Camera 事件相机等配置。`RewardSelectionPanel` 是代码动态创建的，节点级事件未正确分发到卡片。
2. **坐标系转换错误**：全局 `input` 的 `event.getLocation()` 返回的是**屏幕像素坐标**（左下角原点），但之前直接把它传给了 `UITransform.convertToNodeSpaceAR()`，该 API 期望的是**世界坐标/父节点局部坐标**，导致转换结果完全错误。
3. **项目特殊坐标环境**：当前项目 Camera 会跟随玩家移动，UI 节点（包括 `RewardSelectionPanel`）在 `GameLoop._tickCamera()` 中会随 Camera 同步偏移。因此不能假设 UI 节点固定在 `(0,0)`，必须用 Camera 当前位置参与转换。

#### 正确做法
使用全局 input 并手动完成屏幕像素 → 面板局部坐标的转换：

```typescript
private _screenToPanelLocal(screenPos: { x: number; y: number }): Vec3 | null {
    const canvas = this.node.parent;
    if (!canvas) return null;
    const canvasComp = canvas.getComponent(Canvas);
    const cam = canvasComp?.cameraComponent;
    if (!cam) return null;

    const ws = screen.windowSize;
    if (ws.width <= 0 || ws.height <= 0) return null;

    // 屏幕像素 → 归一化坐标 [-1, 1]
    const nx = (screenPos.x / ws.width - 0.5) * 2;
    const ny = (screenPos.y / ws.height - 0.5) * 2;

    // 相机当前可视半宽高（世界单位）
    const halfH = cam.orthoHeight;
    const halfW = halfH * (ws.width / ws.height);

    // 触摸点世界坐标 = 相机位置 + 归一化偏移 * 半宽高
    // 面板局部坐标 = 世界坐标 - 面板节点局部位置
    const panelPos = this.node.getPosition();
    return new Vec3(
        cam.node.position.x + nx * halfW - panelPos.x,
        cam.node.position.y + ny * halfH - panelPos.y,
        0,
    );
}
```

#### 调试 checklist（以后必须按此顺序执行）
1. **先确认事件到达**：在回调第一行加 `console.log`。
2. **再确认坐标转换正确**：打印屏幕像素坐标、转换后的面板局部坐标、目标卡片/按钮的中心和半宽高。
3. **最后做命中检测**：只有前两步都对，命中检测才有意义。
4. **不要反复切换事件类型**：如果事件根本未分发，换 `TOUCH_START`/`TOUCH_END`/`MOUSE_UP` 都无法解决。

---

## 六、子弹系统

### 6.1 子弹基类模板方法
```typescript
// BaseBullet.ts —— 子类禁止覆写 _onHit
protected _onHit(candidate: IQuadEntity): void {
    if (this._hasHit) return;

    const boomerang = this.modifierManager.get<BoomerangModifier>('Boomerang');
    if (boomerang) {
        if (!boomerang.hasBounced) {
            const didBounce = boomerang.triggerBounce(candidate.id);
            if (didBounce) this._onHitEffect(candidate);
            return;
        } else {
            if (boomerang.hitEnemyIds.has(candidate.id)) return;
            this._onHitEffect(candidate);
            this._hasHit = true;
            this._despawn();
            return;
        }
    }

    this._hasHit = true;
    this._onHitEffect(candidate);
    this._despawn();
}

// 子类只覆写这个钩子
protected _onHitEffect(_candidate: IQuadEntity): void {}
```

### 6.2 子弹子类规范
```typescript
@ccclass('FireBullet')
export class FireBullet extends BaseBullet {
    protected _onHitEffect(candidate: IQuadEntity): void {
        EventBus.emit('BULLET_HIT', {
            bulletId: this.id, enemyId: candidate.id,
            damage: this.attr.damage, element: ElementType.FIRE,
            position: { x: this.node.position.x, y: this.node.position.y },
        });
        EventBus.emit('VFX_FIRE_IMPACT', { position: { x: this.node.position.x, y: this.node.position.y } });
    }
}
```

**红线：子类 `_onHitEffect` 严禁调用 `_despawn()` 或修改 `_hasHit`**

---

## 七、元素反应系统

### 7.1 反应矩阵
| 组合 | 反应名 | 倍率 | 效果 |
|------|--------|------|------|
| FIRE + OIL | FIRE_EXPLOSION | 2.0 | 半径 150 AOE |
| LIGHTNING + WATER | LIGHTNING_CONDUCT | 1.5 | 连锁 5 目标 + 麻痹 2s |
| LIGHTNING + OIL | MAGNETIC_PULL | 1.0 | 引力黑洞拉扯 3s |
| GLUE + 任意 | MONSTER_MERGE | 0.5 | 属性叠加融合 |

### 7.2 触发链路
```
子弹命中 → BULLET_HIT → EnemyManager._onBulletHit
→ enemy.applyElement(newElement)
→ ElementReactionHub.checkReaction()
→ 若匹配 → 派发 REACTION:xxx
→ ReactionProcessor._onReaction()
→ 执行伤害/效果 + 派发 VFX_xxx
```

### 7.3 元素衰减
- 默认附着时间：`5.0` 秒
- 在 `EnemyStatusComponent.tick()` 中每帧递减
- 附着期间敌人 Sprite 颜色应变化（待实现视觉反馈）

---

## 八、敌人系统

### 8.1 敌人类型
| 类型 | 颜色 | 特性 |
|------|------|------|
| GRUNT | 红 | 普通 |
| CHARGER | 橙 | 冲锋 |
| FLANKER | 绿 | 侧翼包抄 |
| TANK | 蓝灰 | 50% 元素减伤 |
| RANGED | 紫 | 远程 |

### 8.2 Tank 减伤机制
```typescript
if (config.elementResist?.includes(payload.element)) {
    const reduced = Math.floor(payload.damage * 0.5);
    enemy.takeDamage(reduced);
    EventBus.emit('ENEMY_RESISTED', { enemyId, element: payload.element });
    return;
}
```

---

## 九、肉鸽奖励系统

### 9.1 奖励触发
- 每波结束后 `WAVE_COMPLETE` → `RoguelikeRewardSystem._onWaveComplete()`
- 生成 3 个选项 → `EventBus.emit('REWARD_SHOW')`
- 选择后 `EventBus.emit('GAME_PAUSE')` / `GAME_RESUME`

### 9.2 效果类型
```typescript
enum ModifierEffectType {
    FIRE_RATE_UP, DAMAGE_UP, BULLET_SPEED_UP,
    ADD_BOOMERANG, ADD_ORBIT, MULTISHOT, PIERCE,
    ADD_FIRE_ELEMENT, ADD_OIL_ELEMENT,      // 新增
    ADD_LIGHTNING_ELEMENT, ADD_WATER_ELEMENT, // 新增
}
```

### 9.3 元素解锁流程
```
玩家选择「火种」→ RoguelikeRewardSystem._applyModifier()
→ EventBus.emit('ADD_ELEMENT', { element: 'FIRE' })
→ WeaponSystem._onAddElement()
→ weapon.addElementToQueue(ElementType.FIRE)
→ 队列变为 [..., FIRE]，发射顺序更新
```

---

## 十、敌人攻击系统

### 10.1 攻击配置默认值陷阱
**现象**：敌人不攻击，控制台显示 `damage=0 range=0`。
**根因**：`if (config.attackDamage !== undefined)` 在运行时始终为 `false`。
**解决**：无条件调用 + `??` 默认值：
```typescript
enemy.setAttackConfig(
    config.attackDamage ?? 5,
    config.attackRange ?? 120,
    config.attackCooldown ?? 1.2,
    config.attackType ?? 'MELEE'
);
```

### 10.2 攻击延迟设计（预警 → 伤害分离）
**时序**：
```
敌人进入范围 → 扇形特效（浅色预警） → 0.35s 后 → 扇形加深 + 玩家扣血
```
**代码要点**：
- `_tickAttack()`：触发 VFX + 设置 `_attackDelayTimer`
- `_tickAttackDelay()`：计时结束后才 `emit('PLAYER_DAMAGE')`
- 玩家获得视觉预警后有充足时间拖拽躲避

### 10.3 VFX 颜色加深配合伤害帧
**技巧**：用 `progress > 0.5` 作为 `isHitFrame`，在伤害实际发生的那帧加深颜色、加粗描边，给玩家明确的命中反馈：
```typescript
if (isHitFrame) {
    g.fillColor = new Color(255, 40, 10, alpha * 0.7); // 深红
    g.lineWidth = 3;
} else {
    g.fillColor = new Color(255, 80, 10, alpha * 0.3); // 浅橙
    g.lineWidth = 1.5;
}
```

### 10.4 美术资源替换友好性
- 攻击视觉全部走 `EventBus.emit('VFX_ENEMY_ATTACK')`，不耦合具体渲染
- 敌人 Sprite 闪白反馈封装在 `_playAttackVisual()`，后续替换为动画/粒子只需改一处
- 扇形半径由 `attackRange` 动态驱动，不同敌人自然有不同大小的预警范围

---

## 十一、踩坑精华（一句话版）

| 坑 | 一句话解决 |
|---|-----------|
| 黑屏 | `clearFlags=7, visibility=0x7FFFFFFF, projection=1` |
| 子弹看不见 | 检查 `layer=33554432`、是否在 Canvas 下、spriteFrame 是否设置 |
| Sprite 变大方块 | 先 `sizeMode = CUSTOM`，再设 `spriteFrame` |
| 对象池状态残留 | 回收时手动 `reset()` 所有 Set/Map/基本类型 |
| 子类覆写父类方法 | 用模板方法：`_onHit` 固定 + `_onHitEffect` 钩子 |
| EventBus 内存泄漏 | `on` 必须配对 `off`，回调必须传 `this` |
| 坐标偏移 | 屏幕坐标 → `screenToWorld` → `convertToNodeSpaceAR` |
| 桌面点击无效 | 同时监听 `TOUCH_END` 和 `MOUSE_UP` |
| 子弹不自毁 | `_checkHit` 里 `PoolManager.despawn` 前确认 quadtree 已重建 |
| 波次不启动 | `GameManager.start()` 用 `scheduleOnce` 延迟，避免时序冲突 |
| 敌人不攻击 | 配置字段用 `??` 默认值，不要用 `!== undefined` 条件守卫 |
| 攻击没预警 | 视觉和伤害必须分两个 tick：`_tickAttack` 发 VFX + `_tickAttackDelay` 结算 |

---

## 十二、相机跟随系统（严格居中）

### 12.1 实现方案
**需求**：相机严格居中于玩家，保持平滑跟随，不能移出世界边界。

**为什么选严格居中（而非 look-ahead）**：
- 竖屏单手操作时拇指不会遮挡角色
- 玩家始终在视野正中心，视野最均衡
- 割草游戏的敌人在四面八方，居中更利于观察全场

**架构**：
- 游戏实体（Player、Enemy、Bullet、EnvironmentZone）放在 `WorldContainer` 下
- UI（HUD、面板）直接挂在 `Canvas` 下（不受相机移动影响）
- 相机节点移动即可实现跟随，无需移动整个 Canvas

**PlayerController 核心代码**：
```typescript
// 目标位置 = 玩家位置（严格居中）
targetX = pos.x;
targetY = pos.y;

// 相机边界限制（不能露出世界边界外的黑边）
targetX = clamp(targetX, -worldHalfWidth + camHalfW, worldHalfWidth - camHalfW);
targetY = clamp(targetY, -worldHalfHeight + camHalfH, worldHalfHeight - camHalfH);

// 指数平滑（避免瞬间跳动）
const t = 1 - Math.exp(-smoothSpeed * dt);
camPos.x += (targetX - camPos.x) * t;
```

### 12.2 三个关键修正

| 问题 | 原因 | 解决 |
|-----|------|------|
| 拖拽时坐标偏移 | `_screenToWorld` 没加相机偏移 | 计算时加上 `cameraNode.position.x/y` |
| 敌人总在屏幕中心附近生成 | `_calcSpawnPosition` 以 (0,0) 为中心 | 以 `PlayerController.instance.node.position` 为中心 |
| 相机移出世界边界露出黑边 | 没限制相机位置 | 用 `worldHalf - camHalf` 做边界钳制 |

### 12.3 坐标映射公式（相机跟随模式下）
```
屏幕触摸 → 世界坐标：
worldX = (screenX / winW - 0.5) * (camHalfW * 2) + cameraX
worldY = (screenY / winH - 0.5) * (camHalfH * 2) + cameraY
```
关键：加上 `cameraX/Y` 偏移，否则触摸中心永远映射到世界 (0,0)。

### 12.4 节点层级
```
Canvas
├── WorldContainer          ← 游戏世界（相机跟随目标）
│   ├── BattleRoot
│   │   └── Player
│   └── Enemy_xxx
├── BattleHUD               ← UI（不跟随相机）
├── GameOverPanel
├── RewardSelectionPanel
└── VirtualJoystick
```

---

## 十三、世界边界与相机限制（本轮踩坑记录）

### 13.1 虚拟摇杆底座随相机漂移
**现象**：摇杆底座跟着相机移动，无法固定在触摸点。
**根因**：[`VirtualJoystick._update()`](assets/Scripts/Player/VirtualJoystick.ts:210) 里调用了 `this.node.setPosition()`，与 [`GameLoop._tickCamera()`](assets/Scripts/Core/GameLoop.ts:200) 的 UI delta 补偿发生写入冲突（两个系统同时改同一个坐标）。
**解决**：确立「单点写入」原则——只有 GameLoop 负责写摇杆底座位置（补偿相机位移），VirtualJoystick 只读 `this.node.position`，绝不写入。

### 13.2 场景层级搜索失效（反复犯错）
**现象**：PlayerController 找不到 GameManager，回退到错误的默认边界值。
**根因**：[`BattleTestScaffold._assemble()`](assets/Scripts/Core/BattleTestScaffold.ts:139) 把 GameRoot 的 parent 改成了 Canvas：
```typescript
gameRoot.parent = canvas;
```
导致 [`PlayerController._getWorldBounds()`](assets/Scripts/Player/PlayerController.ts:163) 里的 `scene.getChildByName('GameRoot')` 返回 null。
**解决**：凡是需要访问 GameManager，一律用单例 `GameManager.instance`，禁止通过场景层级搜索（节点 parent 可能在运行时被脚手架或策划调整）。

### 13.3 角色走到边缘露出身体
**现象**：角色可以走到地面边缘，但 Sprite 一半露在深蓝灰地面外。
**根因**：[`_clampPosition()`](assets/Scripts/Player/PlayerController.ts:179) 只把节点中心点限制在世界边界内，没考虑 Sprite 尺寸。
**解决**：clamp 时减去角色半宽/半高：
```typescript
const playerHalfW = ut ? ut.contentSize.width / 2 : 24;
pos.x = Math.max(-halfW + playerHalfW, Math.min(halfW - playerHalfW, pos.x));
```

### 13.4 相机视口超出地面（看到黑色外围）
**现象**：玩家走到边缘时，屏幕露出了黑色背景。
**根因**：相机只跟随玩家，没有限制移动范围，导致视口中心跑到地面外。
**解决**：[`_tickCamera()`](assets/Scripts/Core/GameLoop.ts:200) 在平滑插值后，将相机目标位置钳制在 `世界边界 - 视口半尺寸` 内：
```typescript
targetX = Math.max(-worldHalfW + camHalfW, Math.min(worldHalfW - camHalfW, targetX));
targetY = Math.max(-worldHalfH + camHalfH, Math.min(worldHalfH - camHalfH, targetY));
```
这样相机视野永远只拍摄地面区域。

### 13.5 敌人出生在黑色区域外
**现象**：屏幕边缘出现了站在黑色背景里的敌人。
**根因**：[`_calcSpawnPositionOutsideViewport()`](assets/Scripts/Core/GameManager.ts:315) 以玩家为中心在屏幕外生成，玩家靠近边缘时生成点会落在地面外。
**解决**：生成后再做一次边界钳制，把坐标限制在地面内（留 30px 边距）。

### 13.6 Graphics vs Sprite 绘制地面尺寸
**现象**：用 Sprite 绘制地面时，实际显示只有 64×64 的小方块。
**根因**：Sprite 依赖纹理尺寸，默认 SpriteFrame 的纹理只有 64×64；即使调了 `setContentSize()`，如果没有 `sizeMode = CUSTOM` 且先设置 `spriteFrame`，尺寸仍会被覆盖。
**解决**：地面这种纯色大矩形直接用 [`Graphics`](assets/Scripts/Core/BattleTestScaffold.ts:108) 组件绘制，不受纹理尺寸限制。

### 13.7 坐标系反复横跳（重复错误）
**现象**：在 Camera-local 和 Canvas-local 坐标之间反复切换，导致摇杆有时看不见、有时位置错乱。
**根因**：没有理清楚「相机节点移动」和「Canvas 局部坐标」之间的关系，每次遇到 bug 就换一套坐标算法，反而引入新问题。
**解决**：
- 所有游戏实体（Player、Enemy、Bullet）统一用 **Canvas 局部坐标**（原点屏幕中心）。
- 相机移动只是改变视口中心，不改变坐标系原点。
- UI（摇杆、HUD）挂在 Canvas 下，用 Canvas 局部坐标。
- 不要试图把 UI 节点挂到 Camera 节点下做「相机跟随」，会导致层级混乱。

---

*版本：2026-07-22 | 引擎：Cocos Creator 3.8.6*
