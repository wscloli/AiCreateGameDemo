/**
 * PlayerController.ts
 *
 * 玩家控制器 - 单指拖拽移动 + 武器系统持有
 *
 * 职责：
 * - 纯单指拖拽控制像素主角移动
 * - 持有 WeaponSystem 引用
 * - 不挂载 Cocos update，由 GameLoop 调用 tick(dt)
 */

import { _decorator, Component, Vec3, input, Input, EventTouch, screen, Canvas, UITransform, Node } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 玩家控制器 - 单指绝对跟随拖拽（修复边缘偏移终极版）
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    /** 拖拽时是否施加轻微平滑（0=瞬间跟手，1=完全不跟） */
    @property
    public moveSmoothing: number = 0;

    private _targetPosition: Vec3 = new Vec3(0, 0, 0);
    private _isDragging: boolean = false;
    private _dragOffset: Vec3 = new Vec3(0, 0, 0);
    
    // 动态核心引用
    private _parentUITransform: UITransform | null = null;
    private _canvasComponent: Canvas | null = null;

    protected onLoad(): void {
        // 1. 【核心修复】直接获取玩家当前所在父节点的 UITransform
        // 这样可以自动对齐父节点的 Position, Scale 和 Anchor
        this._parentUITransform = this.node.parent ? this.node.parent.getComponent(UITransform) : null;
        
        // 如果没有父节点，则兜底查找 Canvas
        if (!this._parentUITransform) {
            const canvasNode = this.node.scene?.getChildByName('Canvas');
            this._parentUITransform = canvasNode?.getComponent(UITransform) || null;
        }

        // 2. 缓存 Canvas 组件用于获取场景相机
        const canvasNode = this.node.scene?.getChildByName('Canvas');
        if (canvasNode) {
            this._canvasComponent = canvasNode.getComponent(Canvas);
        }

        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
    }

    /**
     * 将 UI 触摸空间坐标 正确转换为 【当前玩家父节点】 的局部坐标系
     */
    private _uiToParentSpace(event: EventTouch): Vec3 {
        if (!this._parentUITransform) {
            return this.node.position.clone();
        }

        const outPos = new Vec3();
        const touchPos = event.getUILocation();
        
        // 关键点：直接转换到父节点空间，完美抹平多层嵌套、父节点位移、Canvas 缩放带来的边缘误差
        this._parentUITransform.convertToNodeSpaceAR(new Vec3(touchPos.x, touchPos.y, 0), outPos);
        return outPos;
    }

    /**
     * 实时获取相机当前世界可视范围，并正确映射回 【玩家当前父节点】 的局部坐标系
     */
    private _getCameraBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
        const cam = this._canvasComponent?.cameraComponent;
        if (!cam) {
            return { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
        }

        // 1. 获取相机正交半高
        const halfH = cam.orthoHeight;
        // 2. 结合窗口实际分辨率宽高比，算出半宽
        const windowSize = screen.windowSize;
        const halfW = halfH * (windowSize.width / windowSize.height);

        // 3. 相机当前在世界坐标系中的位置
        const camPos = cam.node.worldPosition;

        // 4. 将相机世界空间的四个边界，转换为玩家父节点的局部坐标边界
        if (this._parentUITransform) {
            const camWorldPos = new Vec3(camPos.x, camPos.y, 0);
            const camLocalPos = new Vec3();
            
            // 把相机的世界中心点转到父节点本地空间
            this._parentUITransform.node.inverseTransformPoint(camLocalPos, camWorldPos);

            // 如果父节点有缩放(Scale)，视口边界需要根据父节点的真实缩放比例进行缩放调整
            const parentScale = this._parentUITransform.node.scale;
            const finalHalfW = halfW / Math.abs(parentScale.x);
            const finalHalfH = halfH / Math.abs(parentScale.y);

            return {
                minX: camLocalPos.x - finalHalfW,
                maxX: camLocalPos.x + finalHalfW,
                minY: camLocalPos.y - finalHalfH,
                maxY: camLocalPos.y + finalHalfH
            };
        }

        return { minX: -halfW, maxX: halfW, minY: -halfH, maxY: halfH };
    }

    /**
     * 将坐标钳制在当前相机可视边界内
     */
    private _clampPosition(pos: Vec3): Vec3 {
        const bounds = this._getCameraBounds();
        pos.x = Math.max(bounds.minX, Math.min(bounds.maxX, pos.x));
        pos.y = Math.max(bounds.minY, Math.min(bounds.maxY, pos.y));
        return pos;
    }

    public tick(dt: number): void {
        this._tickMovement(dt);
    }

    private _tickMovement(_dt: number): void {
        if (!this._isDragging) return;

        const pos = this.node.position;
        let nextPos: Vec3;

        if (this.moveSmoothing <= 0) {
            // 瞬间跟手
            nextPos = this._targetPosition.clone();
        } else {
            // 轻微平滑：lerp 到目标位置
            const t = 1 - Math.pow(1 - this.moveSmoothing, 60 * _dt);
            nextPos = new Vec3(
                pos.x + (this._targetPosition.x - pos.x) * t,
                pos.y + (this._targetPosition.y - pos.y) * t,
                pos.z,
            );
        }

        // 最终位置钳制在视野边界内
        this.node.setPosition(this._clampPosition(nextPos));
    }

    // ── 触摸事件：绝对跟随（保持按下时的相对偏移） ──

    private _onTouchStart(event: EventTouch): void {
        this._isDragging = true;

        // 1. 获取当前触点在角色父空间下的精确局部坐标
        const parentPos = this._uiToParentSpace(event);

        // 2. 记录手指与角色当前的相对偏移量
        const pos = this.node.position;
        this._dragOffset.set(pos.x - parentPos.x, pos.y - parentPos.y, 0);

        // 3. 首次按下的目标位置即当前角色位置
        this._targetPosition = this._clampPosition(new Vec3(pos.x, pos.y, pos.z));
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this._isDragging) return;

        // 1. 实时获取触点最新的父空间局部坐标
        const parentPos = this._uiToParentSpace(event);
        
        // 2. 结合初始偏移量，计算出角色应该去的目标点
        const rawTarget = new Vec3(
            parentPos.x + this._dragOffset.x,
            parentPos.y + this._dragOffset.y,
            this.node.position.z,
        );

        // 3. 限制目标位置不超出视野边界
        this._targetPosition = this._clampPosition(rawTarget);
    }

    private _onTouchEnd(_event: EventTouch): void {
        this._isDragging = false;
    }

    public get isMoving(): boolean {
        return this._isDragging;
    }
}