/**
 * OilBullet.ts
 *
 * 油弹子类
 *
 * 特性：
 * - 速度较慢（250 px/s），弹体略大
 * - 命中时强制附着 OIL 状态
 * - OIL 本身无直接伤害，但为 FIRE_EXPLOSION / MAGNETIC_PULL 提供前置条件
 */

import { _decorator, Vec2 } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';
import { BaseBullet } from './BaseBullet';
import { IQuadEntity } from '../Core/Quadtree';

const { ccclass } = _decorator;

@ccclass('OilBullet')
export class OilBullet extends BaseBullet {
    private static readonly OIL_SPEED = 250;
    private static readonly OIL_RADIUS = 12;
    private static readonly OIL_DAMAGE = 3;
    private static readonly OIL_LIFETIME = 4.0;

    public init(
        id: string,
        position: import('cc').Vec3,
        direction: Vec2,
        element: ElementType,
        damage: number,
        speed: number,
        maxLifetime: number = 4.0,
    ): void {
        super.init(id, position, direction, ElementType.OIL, OilBullet.OIL_DAMAGE, OilBullet.OIL_SPEED, OilBullet.OIL_LIFETIME);
        this.radius = OilBullet.OIL_RADIUS;
        this.attr.customData.set('bullet_tint', { r: 180, g: 120, b: 40, a: 255 });
        this.attr.customData.set('bullet_scale', 1.3);
        this.attr.customData.set('bullet_trail', 'oil');
    }

    protected _onHit(candidate: IQuadEntity): void {
        if (this._hasHit) return;
        this._hasHit = true;

        EventBus.emit('BULLET_HIT', {
            bulletId: this.id,
            enemyId: candidate.id,
            element: ElementType.OIL,
            damage: this.attr.damage,
            position: { x: this.node.position.x, y: this.node.position.y },
        });

        EventBus.emit('VFX_OIL_SPLASH', {
            position: { x: this.node.position.x, y: this.node.position.y },
            enemyId: candidate.id,
        });

        this._despawn();
    }
}
