/**
 * VirtualJoystick.ts
 *
 * 虚拟摇杆 UI 组件（浮动底座，左半屏触发）
 *
 * 参考 Many Widgets Joystick2D 方案：
 * - 平时底座淡色显示在左下角作为提示
 * - 左半屏任意位置按下，底座立即跳到手指位置
 * - 平滑连续方向输出（不量化），死区 8px
 * - 恒定速度输出（推离即满速）
 * - 手指抬起后底座回到左下角
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
    public deadZone: number = 5;           // 死区像素（Many Widgets 通常 3~5）

    /** 归一化方向向量（长度恒为 1，或 0 表示在死区内） */
    public output: Vec2 = new Vec2(0, 0);

    public get isActive(): boolean { return this._isActive; }

    private _isActive = false;
    private _fingerId = -1;
    private _camera: Camera | null = null;
    private _baseNode: Node | null = null;
    private _thumbNode: Node | null = null;
    private _baseSprite: Sprite | null = null;
    private _center = new Vec3(0, 0, 0);
    private _defaultCenter = new Vec3(0, 0, 0);
    /** 底座在屏幕上的固定位置（像素坐标），用于抵消相机移动带来的漂移 */
    private _screenBasePos = new Vec2(0, 0);

    protected onLoad(): void {
        VirtualJoystick.instance = this;
        this._initCamera();
        this._calcDefaultCenter();
        this._center.set(this._defaultCenter);
        this._buildVisuals();
        this._setVisible(false);
        this._registerInput();
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
        this.node.setPosition(this._center);

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
        const ws = screen.windowSize;
        return sp.x <= ws.width / 2 && sp.y <= ws.height / 2;
    }

    private _onTouchStart(e: EventTouch): void {
        if (this._isActive) return;
        const loc = e.getLocation();
        if (!this._isInArea(loc)) return;

        this._fingerId = e.getID();
        this._isActive = true;

        // 记录底座在屏幕上的固定位置，后续根据相机位置实时换算为 Canvas 局部坐标
        this._screenBasePos.set(loc.x, loc.y);
        const wp = this._screenToWorld(this._screenBasePos);
        this._center.set(wp);
        this.node.setPosition(this._center);
        this._resetThumb();
        this.output.set(0, 0);

        this._setVisible(true);
    }

    private _onTouchMove(e: EventTouch): void {
        if (!this._isActive || e.getID() !== this._fingerId) return;
        const loc = e.getLocation();
        const wp = this._screenToWorld(loc);
        this._update(wp, loc);
    }

    private _onTouchEnd(e: EventTouch): void {
        if (!this._isActive || e.getID() !== this._fingerId) return;
        this._isActive = false;
        this._fingerId = -1;
        this.output.set(0, 0);
        this._resetThumb();

        this._setVisible(false);
    }

    /** 跟随式底座 + 平滑方向 + 小死区 */
    private _update(fingerWorld: Vec3, fingerScreen: Vec2): void {
        // 根据当前相机位置重新计算底座 Canvas 局部坐标，抵消相机移动造成的漂移
        const baseWorld = this._screenToWorld(this._screenBasePos);
        this._center.set(baseWorld);
        this.node.setPosition(this._center);

        let dx = fingerWorld.x - this._center.x;
        let dy = fingerWorld.y - this._center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.deadZone) {
            // 死区内保持上次方向，不停止移动（割草游戏持续移动体验更佳）
            this._resetThumb();
            return;
        }

        // 跟随逻辑：手指超出 maxDragDistance 时底座向手指方向平移
        if (dist > this.maxDragDistance) {
            const over = dist - this.maxDragDistance;
            const nx = dx / dist;
            const ny = dy / dist;
            this._center.x += nx * over;
            this._center.y += ny * over;
            this.node.setPosition(this._center);

            // 底座在屏幕上移动了，同步更新屏幕坐标
            if (this._camera) {
                const camPos = this._camera.node.position;
                const ws = screen.windowSize;
                const halfH = this._camera.orthoHeight;
                const halfW = halfH * (ws.width / ws.height);
                this._screenBasePos.x = ((this._center.x - camPos.x) / (halfW * 2) + 0.5) * ws.width;
                this._screenBasePos.y = ((this._center.y - camPos.y) / (halfH * 2) + 0.5) * ws.height;
            }

            dx = fingerWorld.x - this._center.x;
            dy = fingerWorld.y - this._center.y;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        this.output.set(nx, ny);

        if (this._thumbNode) {
            const tr = Math.min(dist, this.maxDragDistance) / dist;
            this._thumbNode.setPosition(new Vec3(dx * tr, dy * tr, 0));
        }
    }

    private _screenToWorld(sp: { x: number; y: number }): Vec3 {
        if (!this._camera) this._initCamera();
        const ws = screen.windowSize;
        if (!this._camera || ws.width <= 0 || ws.height <= 0) return new Vec3(0, 0, 0);
        const halfH = this._camera.orthoHeight;
        const halfW = halfH * (ws.width / ws.height);
        const camPos = this._camera.node.position;
        return new Vec3(
            camPos.x + (sp.x / ws.width - 0.5) * (halfW * 2),
            camPos.y + (sp.y / ws.height - 0.5) * (halfH * 2),
            0
        );
    }

    private _resetThumb(): void {
        this._thumbNode?.setPosition(new Vec3(0, 0, 0));
    }

    private _setVisible(visible: boolean): void {
        this.node.active = visible;
    }
}
