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

import { _decorator, Component, Vec3, input, Input, EventTouch, screen, Canvas, view, Camera, Node } from 'cc';
import { HPBar } from '../UI/HPBar';
import { EventBus } from '../Core/EventBus';

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
    public static instance: PlayerController | null = null;
    /** 拖拽时是否施加轻微平滑（0=瞬间跟手，1=完全不跟） */
    @property
    public moveSmoothing: number = 0.15;

    private _targetPosition: Vec3 = new Vec3(0, 0, 0);
    private _isDragging: boolean = false;
    private _dragOffset: Vec3 = new Vec3(0, 0, 0);
    private _camera: Camera | null = null;

    // ── 生命值系统 ──
    @property
    public maxHp: number = 100;
    public hp: number = 100;
    private _hpBarNode: Node | null = null;
    private _hpBar: HPBar | null = null;

    /**
     * 初始化 HPBar（由 BattleTestScaffold 调用）
     */
    public initHpBar(): void {
        if (this._hpBar) return;
        this.hp = this.maxHp;

        this._hpBarNode = new Node('PlayerHPBar');
        this.node.addChild(this._hpBarNode);

        this._hpBar = this._hpBarNode.addComponent(HPBar);
        this._hpBar.init(true, 64, 40);
    }

    /** 受到伤害 */
    public takeDamage(damage: number): void {
        if (this.hp <= 0) return;
        this.hp -= damage;
        if (this.hp < 0) this.hp = 0;

        this._hpBar?.setProgress(this.hp / this.maxHp);

        // 受击视觉反馈（位置在玩家身上）
        const pos = this.node.position;
        EventBus.emit('VFX_PLAYER_HIT', {
            position: { x: pos.x, y: pos.y },
        });

        if (this.hp <= 0) {
            EventBus.emit('PLAYER_DEATH');
        }
    }

    /** 重置生命值（游戏重启时） */
    public resetHp(): void {
        this.hp = this.maxHp;
        this._hpBar?.setProgress(1);
        this._hpBar?.setVisible(true);
    }

    private _onGameStart(): void {
        this.resetHp();
    }

    private _initCamera(): void {
        const canvas = this.node.scene?.getChildByName('Canvas')?.getComponent(Canvas);
        this._camera = canvas?.cameraComponent ?? null;
    }

    /**
     * 将 UI 触摸坐标（getUILocation）转换为世界坐标
     * 关键修正：使用相机实际可视范围做线性映射，而非假设设计分辨率=世界坐标
     */
    private _uiToWorld(uiPos: { x: number; y: number }): Vec3 {
        if (!this._camera) {
            this._initCamera();
        }

        const designSize = view.getDesignResolutionSize();

        // 如果拿不到相机，回退到设计分辨率中心对齐（适配策略固定时可用）
        if (!this._camera) {
            return new Vec3(
                uiPos.x - designSize.width / 2,
                uiPos.y - designSize.height / 2,
                0,
            );
        }

        // 相机实际可视半高
        const halfH = this._camera.orthoHeight;
        // 根据当前窗口宽高比计算可视半宽
        const winSize = screen.windowSize;
        const halfW = halfH * (winSize.width / winSize.height);

        // uiPos 范围是 (0,0) ~ (designWidth, designHeight)
        // 映射到世界坐标 (-halfW, -halfH) ~ (halfW, halfH)
        const x = (uiPos.x / designSize.width - 0.5) * (halfW * 2);
        const y = (uiPos.y / designSize.height - 0.5) * (halfH * 2);

        return new Vec3(x, y, 0);
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
        PlayerController.instance = this;
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        EventBus.on('GAME_START', this._onGameStart, this);
        EventBus.on('PLAYER_DAMAGE', this._onPlayerDamage, this);
    }

    protected onDestroy(): void {
        if (PlayerController.instance === this) {
            PlayerController.instance = null;
        }
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        EventBus.off('GAME_START', this._onGameStart, this);
        EventBus.off('PLAYER_DAMAGE', this._onPlayerDamage, this);
    }

    private _onPlayerDamage(payload: { damage: number; sourceId: string; sourceType: string; position: { x: number; y: number } }): void {
        this.takeDamage(payload.damage);
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

    /**
     * 将屏幕触摸坐标（getLocation，左下角原点，像素单位）转换为世界坐标
     * 关键：screenPos 与 screen.windowSize 同属屏幕像素坐标系，可直接线性映射
     */
    private _screenToWorld(screenPos: { x: number; y: number }): Vec3 {
        if (!this._camera) {
            this._initCamera();
        }
        const winSize = screen.windowSize;
        if (!this._camera || winSize.width <= 0 || winSize.height <= 0) {
            return new Vec3(0, 0, 0);
        }
        const halfH = this._camera.orthoHeight;
        const halfW = halfH * (winSize.width / winSize.height);
        const x = (screenPos.x / winSize.width - 0.5) * (halfW * 2);
        const y = (screenPos.y / winSize.height - 0.5) * (halfH * 2);
        return new Vec3(x, y, 0);
    }

    private _onTouchStart(event: EventTouch): void {
        const worldPos = this._screenToWorld(event.getLocation());
        this._isDragging = true;

        // 记录手指与角色的偏移（在世界坐标系中计算）
        const pos = this.node.position;
        this._dragOffset.set(pos.x - worldPos.x, pos.y - worldPos.y, 0);

        // 首次按下目标位置即当前角色位置（已钳制）
        this._targetPosition = this._clampPosition(new Vec3(pos.x, pos.y, 0));
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this._isDragging) return;

        const worldPos = this._screenToWorld(event.getLocation());
        const rawTarget = new Vec3(
            worldPos.x + this._dragOffset.x,
            worldPos.y + this._dragOffset.y,
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
