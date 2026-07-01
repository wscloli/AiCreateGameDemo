/**
 * BaseBullet.ts
 *
 * 子弹基类（抽象）
 *
 * 职责：
 * - 对象池生命周期管理（spawn/despawn）
 * - 修饰器链驱动（ModifierManager.updateAll）
 * - 命中检测（Quadtree + Vec2.distance）
 * - 命中后通过 EventBus 派发事件，由 EnemyManager 接管
 * - 超时自动回池
 * - 不挂载 Cocos update，由 GameLoop 调用 tick(dt)
 */

import { _decorator, Component, Vec2, Vec3, Graphics, Color, UITransform } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { PoolManager } from '../Core/PoolManager';
import { Quadtree, IQuadEntity } from '../Core/Quadtree';
import { IBulletAttribute, ModifierManager } from '../Player/BulletModifier';
import { EventBus } from '../Core/EventBus';

const { ccclass } = _decorator;

/** 各元素对应的渲染颜色 */
const ELEMENT_COLORS: Record<ElementType, Color> = {
    [ElementType.NONE]: new Color(200, 200, 200, 255),
    [ElementType.OIL]: new Color(180, 120, 40, 255),
    [ElementType.FIRE]: new Color(255, 80, 20, 255),
    [ElementType.LIGHTNING]: new Color(100, 200, 255, 255),
    [ElementType.WATER]: new Color(50, 150, 255, 255),
    [ElementType.GLUE]: new Color(200, 80, 255, 255),
};

@ccclass('BaseBullet')
export class BaseBullet extends Component implements IQuadEntity {
    // ────────────────────────────────
    //  属性
    // ────────────────────────────────

    public id: string = '';
    public radius: number = 8;

    public attr: IBulletAttribute = {
        damage: 10,
        speed: 300,
        velocity: new Vec2(0, 0),
        element: ElementType.NONE,
        lifetime: 0,
        customData: new Map(),
    };

    public modifierManager: ModifierManager = new ModifierManager();
    public maxLifetime: number = 5.0;
    public quadtree: Quadtree | null = null;

    protected _hasHit: boolean = false;
    private _graphics: Graphics | null = null;

    public get x(): number { return this.node.position.x; }
    public get y(): number { return this.node.position.y; }

    // ────────────────────────────────
    //  GameLoop 驱动接口（取代 Cocos update）
    // ────────────────────────────────

    /**
     * 每帧由 GameLoop 统一遍历调用
     */
    public tick(dt: number): void {
        if (this._hasHit) return;

        // 1. 修饰器链篡改属性
        this.modifierManager.updateAll(this.attr, dt);

        // 2. 应用 velocity 驱动位置
        const pos = this.node.position;
        this.node.setPosition(
            pos.x + this.attr.velocity.x * dt,
            pos.y + this.attr.velocity.y * dt,
            pos.z,
        );

        // 3. 超时检测
        this.attr.lifetime += dt;
        if (this.attr.lifetime >= this.maxLifetime) {
            this._despawn();
            return;
        }

        // 4. 命中检测（通过四叉树）
        this._checkHit();
    }

    // ────────────────────────────────
    //  公开接口
    // ────────────────────────────────

    public init(
        id: string,
        position: Vec3,
        direction: Vec2,
        element: ElementType,
        damage: number,
        speed: number,
        maxLifetime: number = 5.0,
    ): void {
        this.id = id;
        this._hasHit = false;
        this.node.setPosition(position);

        this.attr.damage = damage;
        this.attr.speed = speed;
        this.attr.element = element;
        this.attr.lifetime = 0;
        this.attr.customData.clear();

        const normalizedDir = direction.clone().normalize();
        this.attr.velocity.x = normalizedDir.x * speed;
        this.attr.velocity.y = normalizedDir.y * speed;

        this.maxLifetime = maxLifetime;
        this.modifierManager.clear();
        this._drawBulletVisual(element);
        this.node.layer = 33554432; // UI_2D
    }

    private _drawBulletVisual(element: ElementType): void {
        // UITransform：设置渲染尺寸并标记为 UI 节点
        let ut = this.node.getComponent(UITransform);
        if (!ut) {
            ut = this.node.addComponent(UITransform);
        }
        ut.setContentSize(32, 32);

        // Graphics：画纯色圆，不依赖纹理/SpriteFrame
        if (!this._graphics) {
            this._graphics = this.node.addComponent(Graphics);
        }
        const g = this._graphics;
        g.clear();

        const color = ELEMENT_COLORS[element] ?? ELEMENT_COLORS[ElementType.NONE];
        g.fillColor = color;
        g.circle(0, 0, 8);
        g.fill();
    }

    public forceHit(): void {
        if (this._hasHit) return;
        this._hasHit = true;
        this._despawn();
    }

    // ────────────────────────────────
    //  内部方法
    // ────────────────────────────────

    private _checkHit(): void {
        if (!this.quadtree) return;

        const pos = this.node.position;
        const candidates = this.quadtree.query(pos.x, pos.y, this.radius + 20);

        for (const candidate of candidates) {
            if (candidate.id === this.id) continue; // 排除自身

            const dist = Vec2.distance(
                new Vec2(pos.x, pos.y),
                new Vec2(candidate.x, candidate.y),
            );

            if (dist <= this.radius + candidate.radius) {
                this._onHit(candidate);
                return;
            }
        }
    }

    protected _onHit(candidate: IQuadEntity): void {
        if (this._hasHit) return;
        this._hasHit = true;

        EventBus.emit('BULLET_HIT', {
            bulletId: this.id,
            enemyId: candidate.id,
            element: this.attr.element,
            damage: this.attr.damage,
            position: { x: this.node.position.x, y: this.node.position.y },
        });

        this._despawn();
    }

    protected _despawn(): void {
        if (this._graphics) {
            this._graphics.clear();
        }
        if (this.quadtree) {
            this.quadtree.remove(this.id);
        }
        this.modifierManager.clear();
        this.attr.customData.clear();
        PoolManager.despawn(this);
    }
}
