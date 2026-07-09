/**
 * FireBullet.ts
 *
 * 火球子类
 *
 * 特性：
 * - 速度快（400 px/s），弹体较小
 * - 命中时强制附着 FIRE 状态
 * - 造成中等直接伤害
 */

import { _decorator, Vec2 } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';
import { BaseBullet } from './BaseBullet';
import { IQuadEntity } from '../Core/Quadtree';

const { ccclass } = _decorator;

@ccclass('FireBullet')
export class FireBullet extends BaseBullet {
    private static readonly FIRE_SPEED = 400;
    private static readonly FIRE_RADIUS = 8;
    private static readonly FIRE_DAMAGE = 15;
    private static readonly FIRE_LIFETIME = 3.0;

    public init(
        id: string,
        position: import('cc').Vec3,
        direction: Vec2,
        element: ElementType,
        damage: number,
        speed: number,
        maxLifetime: number = 3.0,
    ): void {
        super.init(id, position, direction, ElementType.FIRE, FireBullet.FIRE_DAMAGE, FireBullet.FIRE_SPEED, FireBullet.FIRE_LIFETIME);
        this.radius = FireBullet.FIRE_RADIUS;
        this.attr.customData.set('bullet_tint', { r: 255, g: 120, b: 20, a: 255 });
        this.attr.customData.set('bullet_scale', 0.9);
        this.attr.customData.set('bullet_trail', 'fire');
    }

    protected _onHitEffect(candidate: IQuadEntity): void {
        EventBus.emit('BULLET_HIT', {
            bulletId: this.id,
            enemyId: candidate.id,
            element: ElementType.FIRE,
            damage: this.attr.damage,
            position: { x: this.node.position.x, y: this.node.position.y },
        });

        EventBus.emit('VFX_FIRE_IMPACT', {
            position: { x: this.node.position.x, y: this.node.position.y },
            enemyId: candidate.id,
        });
    }
}
