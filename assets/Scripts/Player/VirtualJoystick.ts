/**
 * VirtualJoystick.ts
 *
 * 虚拟摇杆 UI 组件（浮动底座，左半屏触发）
 *
 * - 挂在 Canvas 下，使用世界坐标
 * - GameLoop._tickCamera 每帧加 delta 补偿相机移动
 * - _update() 只读取 this.node.position，绝不重新设置底座位置
 */

import { _decorator, Component, Vec3, Vec2, input, Input, EventTouch, screen, Camera, Node, Sprite, SpriteFrame, Texture2D, UITransform, Color, Canvas, director } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('VirtualJoystick')
export class VirtualJoystick extends Component {
    public static instance: VirtualJoystick | null = null;

    @property
    public baseRadius: number = 60;
    @property
    public thumbRadius: number = 24;
    @property
    public maxDragDistance: number = 60;
    @property
    public deadZone: number = 5;

    /** 归一化方向向量 */
    public output: Vec2 = new Vec2(0, 0);

    public get isActive(): boolean { return this._isActive; }

    private _isActive = false;
    private _fingerId = -1;
    private _camera: Camera | null = null;
    private _baseNode: Node | null = null;
    private _thumbNode: Node | null = null;
    private _baseSprite: Sprite | null = null;
    private _defaultCenter = new Vec3(0, 0, 0);

    protected onLoad(): void {
        try {
            VirtualJoystick.instance = this;
            this._initCamera();
            this._calcDefaultCenter();
            this._buildVisuals();
            this._setVisible(false);
            this._registerInput();
            console.log('[VirtualJoystick] onLoad 成功 (build: 2026-07-21-v2)');
        } catch (e) {
            console.error('[VirtualJoystick] onLoad 失败:', e);
        }
    }

    protected onDestroy(): void {
        if (VirtualJoystick.instance === this) VirtualJoystick.instance = null;
        this._unregisterInput();
    }

    private _initCamera(): void {
        const canvas = this.node.scene?.getChildByName('Canvas');
        if (canvas) {
            const cc = canvas.getComponent(Canvas);
            if (cc?.cameraComponent) { this._camera = cc.cameraComponent; return; }
        }
        const scene = director.getScene();
        if (scene) {
            const n = scene.getChildByName('Main Camera') || scene.getChildByName('Camera');
            if (n) this._camera = n.getComponent(Camera);
        }
    }

    private _calcDefaultCenter(): void {
        if (!this._camera) this._initCamera();
        const ws = screen.windowSize;
        if (!this._camera || ws.width <= 0 || ws.height <= 0) {
            this._defaultCenter.set(-200, -300, 0); return;
        }
        const halfH = this._camera.orthoHeight;
        const halfW = halfH * (ws.width / ws.height);
        const m = 140;
        this._defaultCenter.set(-halfW + m, -halfH + m, 0);
    }

    private _buildVisuals(): void {
        this.node.setPosition(this._defaultCenter);
        if (!this.node.getComponent(UITransform)) {
            this.node.addComponent(UITransform);
        }

        this._baseNode = new Node('JoystickBase');
        this.node.addChild(this._baseNode);
        this._baseSprite = this._baseNode.addComponent(Sprite);
        this._baseSprite.spriteFrame = this._createCircleSpriteFrame(80, 80, new Color(80, 80, 80, 100));
        this._baseSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._baseNode.addComponent(UITransform).setContentSize(this.baseRadius * 2, this.baseRadius * 2);

        this._thumbNode = new Node('JoystickThumb');
        this.node.addChild(this._thumbNode);
        const ts = this._thumbNode.addComponent(Sprite);
        ts.spriteFrame = this._createCircleSpriteFrame(64, 64, new Color(220, 220, 220, 200));
        ts.sizeMode = Sprite.SizeMode.CUSTOM;
        this._thumbNode.addComponent(UITransform).setContentSize(this.thumbRadius * 2, this.thumbRadius * 2);

        this._resetThumb();
    }

    private _createCircleSpriteFrame(w: number, h: number, color: Color): SpriteFrame {
        const tex = new Texture2D();
        tex.reset({ width: w, height: h, format: Texture2D.PixelFormat.RGBA8888 });
        const data = new Uint8Array(w * h * 4);
        const cx = w / 2, cy = h / 2, r = Math.min(cx, cy) - 2;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
                const i = (y * w + x) * 4;
                if (d <= r) { data[i] = color.r; data[i + 1] = color.g; data[i + 2] = color.b; data[i + 3] = color.a; }
                else { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; }
            }
        }
        tex.uploadData(data);
        const sf = new SpriteFrame();
        sf.texture = tex;
        sf.rect.width = w; sf.rect.height = h;
        sf.originalSize.width = w; sf.originalSize.height = h;
        return sf;
    }

    private _registerInput(): void {
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
    }
    private _unregisterInput(): void {
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
    }

    private _isInArea(sp: { x: number; y: number }): boolean {
        return true;
    }

    /**
     * EventTouch -> Canvas 局部坐标。
     * 策略：以 Camera 节点位置为视口中心，按屏幕像素偏移直接推算 Canvas 局部坐标。
     * 避开 screenToWorld + convertToNodeSpaceAR 的适配层歧义。
     */
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

    private _onTouchStart(e: EventTouch): void {
        if (this._isActive) return;
        const loc = e.getLocation();
        if (!this._isInArea(loc)) return;

        this._fingerId = e.getID();
        this._isActive = true;

        const lp = this._eventToLocal(e);
        this.node.setPosition(lp);
        this._resetThumb();
        this.output.set(0, 0);

        this._setVisible(true);
        console.log('[VirtualJoystick] TouchStart', loc.x, loc.y, 'local:', lp.x, lp.y);
    }

    private _onTouchMove(e: EventTouch): void {
        if (!this._isActive || e.getID() !== this._fingerId) return;
        const lp = this._eventToLocal(e);
        this._update(lp);
    }

    private _onTouchEnd(e: EventTouch): void {
        if (!this._isActive || e.getID() !== this._fingerId) return;
        this._isActive = false;
        this._fingerId = -1;
        this.output.set(0, 0);
        this._resetThumb();
        this._setVisible(false);
        console.log('[VirtualJoystick] TouchEnd');
    }

    /**
     * 只计算 thumb 偏移和 output 方向。
     * 底座位置由 _onTouchStart 初始化 + GameLoop._tickCamera 每帧补偿 delta 来维持固定。
     * 这里绝不调用 this.node.setPosition()。
     */
    private _update(fingerLocal: Vec3): void {
        const center = this.node.getPosition();

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

    private _resetThumb(): void {
        this._thumbNode?.setPosition(new Vec3(0, 0, 0));
    }

    private _setVisible(visible: boolean): void {
        this.node.active = visible;
    }
}
