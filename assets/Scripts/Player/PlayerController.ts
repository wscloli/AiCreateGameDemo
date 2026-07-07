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

import { _decorator, Component, Vec3, input, Input, EventTouch, screen, Canvas, UITransform, view } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 玩家控制器 - 单指绝对跟随拖拽
 *
 * 设计原则：
 * - 手指按下的瞬间记录与角色的偏移量
 * - 拖拽过程中角色严格跟随手指（保持初始偏移）
 * - 无速度限制、无追赶插值，最大化跟手感
 * - WeaponSystem.tick 由 GameLoop 统一驱动，此处不重复调用
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    /** 拖拽时是否施加轻微平滑（0=瞬间跟手，1=完全不跟） */
    @property
    public moveSmoothing: number = 0.15;

    private _targetPosition: Vec3 = new Vec3(0, 0, 0);
    private _isDragging: boolean = false;
    private _dragOffset: Vec3 = new Vec3(0, 0, 0);

    /**
     * 将 UI 触摸坐标（getUILocation）转换为 Canvas 局部坐标
     * Canvas 局部坐标系以 Canvas 中心为原点，与 node.position 一致
     */
    private _uiToCanvas(uiPos: { x: number; y: number }): Vec3 {
        // getUILocation 始终返回设计分辨率尺度坐标；
        // 但 uiTransform.contentSize 会被 Canvas 的 Widget 拉伸为实际屏幕尺寸，
        // 两者尺度不一致就会导致边缘偏移。因此使用 view.getDesignResolutionSize()。
        const designSize = view.getDesignResolutionSize();
        return new Vec3(
            uiPos.x - designSize.width / 2,
            uiPos.y - designSize.height / 2,
            0,
        );
    }

    /**
     * 实时获取相机当前可视范围（半宽高）
     */
    private _getCameraBounds(): { halfW: number; halfH: number } {
        const canvas = this.node.scene?.getChildByName('Canvas')?.getComponent(Canvas);
        const cam = canvas?.cameraComponent;
        if (!cam) return { halfW: 1000, halfH: 1000 };

        const halfH = cam.orthoHeight;
        const size = screen.windowSize;
        const halfW = halfH * (size.width / size.height);
        return { halfW, halfH };
    }

    /**
     * 将坐标钳制在当前相机可视边界内
     */
    private _clampPosition(pos: Vec3): Vec3 {
        const { halfW, halfH } = this._getCameraBounds();
        pos.x = Math.max(-halfW, Math.min(halfW, pos.x));
        pos.y = Math.max(-halfH, Math.min(halfH, pos.y));
        return pos;
    }

    protected onLoad(): void {
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

        // 最终位置钳制在世界边界内
        this.node.setPosition(this._clampPosition(nextPos));
    }

    // ── 触摸事件：绝对跟随（保持按下时的相对偏移） ──

    private _onTouchStart(event: EventTouch): void {
        const canvasPos = this._uiToCanvas(event.getUILocation());
        this._isDragging = true;

        // 记录手指与角色的偏移（在同一坐标系 Canvas 局部坐标中计算）
        const pos = this.node.position;
        this._dragOffset.set(pos.x - canvasPos.x, pos.y - canvasPos.y, 0);

        // 首次按下目标位置即当前角色位置（已钳制）
        this._targetPosition = this._clampPosition(new Vec3(pos.x, pos.y, 0));
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this._isDragging) return;

        const canvasPos = this._uiToCanvas(event.getUILocation());
        const rawTarget = new Vec3(
            canvasPos.x + this._dragOffset.x,
            canvasPos.y + this._dragOffset.y,
            0,
        );
        // 限制目标位置不超出世界边界
        this._targetPosition = this._clampPosition(rawTarget);
    }

    private _onTouchEnd(_event: EventTouch): void {
        this._isDragging = false;
    }

    public get isMoving(): boolean {
        return this._isDragging;
    }
}
