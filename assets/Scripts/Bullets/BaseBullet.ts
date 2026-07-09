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

import { _decorator, Component, Vec2, Vec3, Color, UITransform, Sprite } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { PoolManager } from '../Core/PoolManager';
import { Quadtree, IQuadEntity } from '../Core/Quadtree';
import { IBulletAttribute, ModifierManager, BoomerangModifier } from '../Player/BulletModifier';
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

        // 3. 将当前位置同步给修饰器（供 Boomerang 等按距离触发）
        const newPos = this.node.position;
        this.attr.customData.set('currentPos', { x: newPos.x, y: newPos.y });

        // 4. 弹回阶段：检测是否已回到玩家身边，是则销毁
        const boomerang = this.modifierManager.get<BoomerangModifier>('Boomerang');
        if (boomerang && boomerang.hasBounced) {
            if (boomerang.shouldDespawn({ x: newPos.x, y: newPos.y })) {
                this._despawn();
                return;
            }
        }

        // 5. 超时检测
        this.attr.lifetime += dt;
        if (this.attr.lifetime >= this.maxLifetime) {
            this._despawn();
            return;
        }

        // 6. 命中检测（通过四叉树）
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
        this._syncSpriteColor(element);
        this.node.layer = 33554432; // UI_2D

        // 为距离触发类修饰器记录发射位置
        this.attr.customData.set('spawnPos', { x: position.x, y: position.y });
    }

    /**
     * 同步 Sprite 颜色以匹配元素类型。
     * 保留 Sprite 组件（而非替换为 Graphics），确保后续可无缝接入帧动画/贴图资源。
     */
    private _syncSpriteColor(element: ElementType): void {
        const sp = this.node.getComponent(Sprite);
        if (sp) {
            sp.color = ELEMENT_COLORS[element] ?? ELEMENT_COLORS[ElementType.NONE];
        }

        let ut = this.node.getComponent(UITransform);
        if (!ut) {
            ut = this.node.addComponent(UITransform);
        }
        ut.setContentSize(32, 32);
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

    /**
     * 命中处理模板方法。
     * 子类**禁止**覆写此方法；如需自定义命中效果，覆写 _onHitEffect。
     */
    protected _onHit(candidate: IQuadEntity): void {
        if (this._hasHit) return;

        const boomerang = this.modifierManager.get<BoomerangModifier>('Boomerang');
        if (boomerang) {
            if (!boomerang.hasBounced) {
                // 首次命中（飞出阶段）：触发弹回，播放效果，子弹继续飞行
                const didBounce = boomerang.triggerBounce(candidate.id);
                if (didBounce) {
                    this._onHitEffect(candidate);
                }
                return;
            } else {
                // 返航阶段：如果还是刚才弹回的同一个敌人，先忽略
                if (boomerang.hitEnemyIds.has(candidate.id)) {
                    return;
                }
                // 返航阶段命中新敌人：播放效果，子弹销毁
                this._onHitEffect(candidate);
                this._hasHit = true;
                this._despawn();
                return;
            }
        }

        // 普通子弹：播放效果，命中即销毁
        this._hasHit = true;
        this._onHitEffect(candidate);
        this._despawn();
    }

    /**
     * 命中效果钩子，供子类覆写。
     * 此处只负责发射事件 / VFX，严禁调用 _despawn 或修改 _hasHit。
     */
    protected _onHitEffect(_candidate: IQuadEntity): void {
        // 默认空实现
    }

    protected _despawn(): void {
        if (this.quadtree) {
            this.quadtree.remove(this.id);
        }

        // 对象池回收前重置 BoomerangModifier 实例状态
        const boomerang = this.modifierManager.get<BoomerangModifier>('Boomerang');
        if (boomerang) {
            boomerang.reset();
        }

        this.modifierManager.clear();
        this.attr.customData.clear();
        PoolManager.despawn(this);
    }
}
