# 虚拟摇杆底座漂移问题 — 解决方案文档

## 1. 问题描述

在 Cocos Creator 3.8.6 + TypeScript 项目中，虚拟摇杆（VirtualJoystick）的底座在玩家移动、相机跟随后，会随相机一起漂移，而不是固定在屏幕上的初始触摸点。

**现象：**
- 摇杆底座固定在左下角时 → 正常，不漂移
- 摇杆底座固定在触摸点时 → 随相机移动而漂移

## 2. 根因分析

### 2.1 坐标系背景

本项目采用 **"土豆兄弟式" 相机跟随**：
- `Camera` 节点是 `Canvas` 的子节点
- 玩家移动时，`GameLoop._tickCamera()` 平滑移动 `Camera` 节点的局部坐标
- 由于 `Camera` 是 `Canvas` 子节点，移动 `Camera` 会改变整个视口中心，导致世界坐标系相对屏幕发生偏移

### 2.2 为什么固定在左下角可以？

当摇杆固定在左下角时：
1. `_onTouchStart` 设置底座位置为左下角世界坐标（如 `(-260, -260)`）
2. `GameLoop._tickCamera()` 每帧计算相机移动 delta（`deltaX`, `deltaY`）
3. 将 delta 加到所有 UI 节点（包括 VirtualJoystick）的 `position` 上
4. 视觉上底座始终固定在屏幕左下角

**关键：底座位置只被设置一次，之后全部由 `GameLoop` 维护。**

### 2.3 为什么触摸点会漂移？

当摇杆固定在触摸点时，之前的实现存在 **坐标系统争用**：

**错误路径 1：`screenToWorld + convertToNodeSpaceAR`**
```typescript
// 问题：screenToWorld 在 Cocos 3.x Canvas 适配层下，可能引入隐式缩放歧义
const worldPos = this._camera.screenToWorld(new Vec3(loc.x, loc.y, 0), worldPos);
return canvasUT.convertToNodeSpaceAR(worldPos);
```
- `screenToWorld` 返回的是世界坐标，但 `Camera` 节点移动后，"世界坐标" 和 "Canvas 局部坐标" 的映射关系已经改变
- `convertToNodeSpaceAR` 在适配缩放场景下可能产生额外的坐标偏移
- 导致 `_onTouchStart` 算出的初始位置本身就有误差

**错误路径 2：`_update()` 中调用 `this.node.setPosition()`**
```typescript
// 致命：_update() 每帧重写底座位置，与 GameLoop 的 delta 补偿互相冲突
private _update(fingerLocal: Vec3): void {
    // ... 计算逻辑 ...
    this.node.setPosition(newBasePos); // ❌ 与 GameLoop 争用
}
```
- `GameLoop._tickCamera()` 每帧先加 delta 补偿 → 底座位置正确
- `_update()` 随后根据新的 finger 位置重新计算底座位置 → 覆盖了 GameLoop 的补偿
- 两帧之间产生累积漂移

## 3. 解决方案

### 3.1 核心原则：单一写者原则

**`VirtualJoystick.node.position` 只能由一个系统写入。**

当前架构下，写入者是 `GameLoop._tickCamera()`（通过 delta 补偿维持 UI 固定）。
`VirtualJoystick` 只能读取，不能写入底座位置。

### 3.2 三文件配合

| 文件 | 职责 |
|------|------|
| [`VirtualJoystick.ts`](assets/Scripts/Player/VirtualJoystick.ts) | 读取 `node.position`，计算 thumb 偏移和 output 方向，**绝不调用 `node.setPosition()`** |
| [`GameLoop.ts`](assets/Scripts/Core/GameLoop.ts) | 每帧计算相机 delta，加到 VirtualJoystick 的 `position` 上，维持视觉上固定 |
| [`BattleTestScaffold.ts`](assets/Scripts/Core/BattleTestScaffold.ts) | 运行时创建 VirtualJoystick 节点，挂在 Canvas 下 |

### 3.3 新的坐标转换：Camera 视口中心 + 像素偏移

不再使用 `screenToWorld + convertToNodeSpaceAR`，改为直接以 **Camera 节点位置** 为视口中心，按屏幕像素偏移推算 Canvas 局部坐标：

```typescript
private _eventToLocal(e: EventTouch): Vec3 {
    if (!this._camera) this._initCamera();
    if (!this._camera) return new Vec3(0, 0, 0);

    const loc = e.getLocation();     // 左下角原点，逻辑像素
    const ws = screen.windowSize;
    if (ws.width <= 0 || ws.height <= 0) return new Vec3(0, 0, 0);

    // 像素 -> 世界单位：屏幕高度对应 2*orthoHeight 世界单位
    const pixelToWorld = (2 * this._camera.orthoHeight) / ws.height;

    // 相对于屏幕中心的偏移（像素）-> 世界单位
    const offsetX = (loc.x - ws.width * 0.5) * pixelToWorld;
    const offsetY = (loc.y - ws.height * 0.5) * pixelToWorld;

    // Camera 节点在 Canvas 局部坐标系中的位置（Camera 是 Canvas 子节点）
    const camPos = this._camera.node.position;

    return new Vec3(camPos.x + offsetX, camPos.y + offsetY, 0);
}
```

**原理：**
- `Camera.orthoHeight` 定义了视口垂直方向的一半世界单位
- 屏幕高度 `ws.height` 对应 `2 * orthoHeight` 世界单位
- 因此 `pixelToWorld = (2 * orthoHeight) / ws.height` 是像素到世界单位的转换系数
- 触摸点相对屏幕中心的像素偏移，乘以 `pixelToWorld`，就是相对 Camera 中心的世界偏移
- 加上 Camera 节点的 Canvas 局部坐标，即为触摸点在 Canvas 局部坐标系中的正确位置

### 3.4 `_update()` 只读不写

```typescript
private _update(fingerLocal: Vec3): void {
    const center = this.node.getPosition();  // 只读

    let dx = fingerLocal.x - center.x;
    let dy = fingerLocal.y - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < this.deadZone) {
        this._resetThumb();
        return;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    this.output.set(nx, ny);

    if (this._thumbNode) {
        const tr = Math.min(dist, this.maxDragDistance) / dist;
        this._thumbNode.setPosition(new Vec3(dx * tr, dy * tr, 0));
    }
}
```

**注意：** 此方法只计算 thumb 偏移和 output 方向，**绝不调用 `this.node.setPosition()`**。

## 4. GameLoop 的 delta 补偿机制

```typescript
private _tickCamera(dt: number): void {
    // ... 相机平滑跟随玩家 ...
    const deltaX = targetX - camPos.x;
    const deltaY = targetY - camPos.y;
    this._cameraNode.setPosition(targetX, targetY, camPos.z);

    // 同步 UI 层位置，抵消相机移动，保持 UI 固定在屏幕上
    const canvas = this.node.scene?.getChildByName('Canvas');
    if (canvas) {
        const uiNames = ['BattleHUD', 'GameOverPanel', 'RewardSelectionPanel', 'VirtualJoystick'];
        for (const name of uiNames) {
            const n = canvas.getChildByName(name);
            if (n && n.isValid) {
                const p = n.getPosition();
                n.setPosition(p.x + deltaX, p.y + deltaY, p.z);
            }
        }
    }
}
```

**机制：** 相机移动了 `(deltaX, deltaY)`，UI 节点同步加上相同的 `(deltaX, deltaY)`，使得 UI 在屏幕上的视觉位置保持不变。

## 5. 关键注意事项

### 5.1 禁止在 _update() 中设置底座位置

```typescript
// ❌ 错误：_update() 中调用 setPosition 会与 GameLoop 争用
private _update(fingerLocal: Vec3): void {
    // ...
    this.node.setPosition(newPos); // 绝对禁止
}
```

### 5.2 禁止将 VirtualJoystick 挂到 Camera 节点下

```typescript
// ❌ 错误：Camera-local 坐标与 Canvas 局部坐标系不匹配
// Camera 移动时，Camera 子节点的局部坐标需要额外转换
// 会导致坐标混乱、摇杆不可见或位置错误
```

### 5.3 不要在场景中手动放置 VirtualJoystick 节点

```typescript
// ❌ 错误：场景中有手动 VirtualJoystick 节点 + BattleTestScaffold 运行时创建
// 会导致出现两个摇杆
```

正确做法：由 [`BattleTestScaffold._assemble()`](assets/Scripts/Core/BattleTestScaffold.ts:108) 统一运行时创建：
```typescript
const jsNode = new Node('VirtualJoystick');
canvas.addChild(jsNode);
jsNode.addComponent(VirtualJoystick);
```

### 5.4 确保 VirtualJoystick 在 GameLoop 的 UI 补偿列表中

如果新增 UI 面板需要固定显示，必须在 [`GameLoop._tickCamera()`](assets/Scripts/Core/GameLoop.ts:231) 的 `uiNames` 数组中添加对应的节点名：

```typescript
const uiNames = ['BattleHUD', 'GameOverPanel', 'RewardSelectionPanel', 'VirtualJoystick'];
// 新增 UI 节点时，在此处追加名称
```

### 5.5 坐标转换公式依赖 orthoHeight

新的 `_eventToLocal()` 公式依赖 `Camera.orthoHeight` 和 `screen.windowSize`：
- 如果运行时修改了 `orthoHeight`（如响应屏幕旋转），需要重新计算
- `screen.windowSize` 返回的是逻辑像素尺寸，已自动适配 DPI
- 该公式仅适用于 **正交投影（ORTHO）** 相机

## 6. 验证步骤

1. 在 Cocos Creator 中打开 `MainScene.scene`
2. 点击预览
3. 触摸屏幕任意位置 → 摇杆底座出现
4. 拖拽移动玩家 → 相机跟随
5. **观察：** 摇杆底座始终固定在初始触摸点的屏幕位置，不随相机漂移
6. 释放手指 → 摇杆消失
7. 再次触摸新位置 → 摇杆在新位置出现，重复步骤 4-5

## 7. 相关文件

| 文件 | 说明 |
|------|------|
| [`assets/Scripts/Player/VirtualJoystick.ts`](assets/Scripts/Player/VirtualJoystick.ts) | 虚拟摇杆组件（输入处理 + 视觉渲染） |
| [`assets/Scripts/Core/GameLoop.ts`](assets/Scripts/Core/GameLoop.ts) | 主循环（相机跟随 + UI delta 补偿） |
| [`assets/Scripts/Core/BattleTestScaffold.ts`](assets/Scripts/Core/BattleTestScaffold.ts) | 场景脚手架（运行时创建摇杆节点） |

---

## 8. 角色移动与相机跟随方案

### 8.1 需求

- 角色通过虚拟摇杆控制移动方向
- 角色可以走到地面边缘，但不能走出地面（Sprite 完整留在地面内）
- 相机始终跟随角色，走到边缘时屏幕显示黑色背景

### 8.2 角色移动边界限制

[`PlayerController._clampPosition()`](assets/Scripts/Player/PlayerController.ts:176) 在计算下一帧位置后，将坐标钳制在地面边界减去角色半宽/半高的范围内：

```typescript
private _clampPosition(pos: Vec3): Vec3 {
    const { halfW, halfH } = this._getWorldBounds();
    const ut = this.node.getComponent(UITransform) as UITransform | null;
    const playerHalfW = ut ? ut.contentSize.width / 2 : 16;
    const playerHalfH = ut ? ut.contentSize.height / 2 : 16;
    pos.x = Math.max(-halfW + playerHalfW, Math.min(halfW - playerHalfW, pos.x));
    pos.y = Math.max(-halfH + playerHalfH, Math.min(halfH - playerHalfH, pos.y));
    return pos;
}
```

**关键点：**
- 角色中心点不能到达地面边界，必须留出 `playerHalfW/playerHalfH` 的边距
- 这样 Sprite 的四周始终完整留在地面内，不会露出到黑色区域
- 世界边界通过 `GameManager.instance` 单例获取（禁止场景层级搜索，因为节点 parent 可能被运行时调整）

### 8.3 相机跟随策略

[`GameLoop._tickCamera()`](assets/Scripts/Core/GameLoop.ts:200) 只做平滑插值跟随玩家，**不限制相机边界**：

```typescript
// 平滑插值：speed 越大越跟手
const t = 1 - Math.exp(-this.cameraFollowSpeed * dt);
let targetX = camPos.x + (playerPos.x - camPos.x) * t;
let targetY = camPos.y + (playerPos.y - camPos.y) * t;

// 不限制相机边界：角色走到边缘时，视野露出黑色背景
this._cameraNode.setPosition(targetX, targetY, camPos.z);
```

**与之前策略的区别：**
- ❌ 旧策略：相机也限制在世界边界内，导致角色走到边缘时画面被"推"回来，摇杆手感像被掐住
- ✅ 新策略：相机自由跟随，角色贴到边界时画面自然露出黑色，玩家明确感知到"走到头了"

### 8.4 踩坑历史（角色移动与边界）

| 问题 | 原因 | 解决 |
|------|------|------|
| 角色不能走到边缘 | `_getWorldBounds()` 用 `scene.getChildByName('GameRoot')` 查找，但 BattleTestScaffold 把 GameRoot parent 改成了 Canvas | 改用 `GameManager.instance` 单例 |
| 角色走到边缘露出一半身体 | `_clampPosition()` 只限制中心点，没减 Sprite 半宽 | 减去 `contentSize.width/2` 边距 |
| 摇杆推到边缘像被掐住 | 相机也限制了边界，角色停 → 相机停 → 画面冻结 | 删除相机边界限制，让视野露出黑色 |
| 角色直接走出地面 | 删除了 `_clampPosition()` 的所有限制 | 恢复 clamp，但保留角色半宽边距 |

### 8.5 当前最终行为

1. 摇杆推到底 → 角色持续向该方向移动
2. 角色中心到达 `地面边界 - 半宽` 时停止
3. Sprite 完整留在地面内，不露出黑色区域
4. 相机继续跟随角色中心，画面边缘自然显示黑色背景
5. 玩家明确感知到"走到边界了"，但摇杆输入没有被切断

---

**角色尺寸：** 运行时创建的 Player 节点为 `32×32`（[`BattleTestScaffold.ts`](assets/Scripts/Core/BattleTestScaffold.ts:156)），若后续需要调整，同步修改 `playerUt.setContentSize()`。

---

*文档版本: 2026-07-23*
*对应代码版本: build 2026-07-23*
