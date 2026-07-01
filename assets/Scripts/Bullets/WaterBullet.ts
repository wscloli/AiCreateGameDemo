/**
 * WaterBullet.ts
 *
 * 水弹子类
 *
 * 特性：
 * - 中等速度（300 px/s），弹体中等
 * - 命中时强制附着 WATER 状态
 * - 本身伤害低，但为 LIGHTNING_CONDUCT 提供传导介质
 */

import { _decorator, Vec2 } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';
import { BaseBullet } from './BaseBullet';
import { IQuadEntity } from '../Core/Quadtree';

const { ccclass } = _decorator;

@ccclass('WaterBullet')
export class WaterBullet extends BaseBullet {
    private static readonly WATER_SPEED = 300;
    private static readonly WATER_RADIUS = 10;
    private static readonly WATER_DAMAGE = 5;
    private static readonly WATER_LIFETIME = 3.5;

    public init(
        id: string,
        position: import('cc').Vec3,
        direction: Vec2,
        element: ElementType,
        damage: number,
        speed: number,
        maxLifetime: number = 3.5,
    ): void {
        super.init(id, position, direction, ElementType.WATER, WaterBullet.WATER_DAMAGE, WaterBullet.WATER_SPEED, WaterBullet.WATER_LIFETIME);
        this.radius = WaterBullet.WATER_RADIUS;
        this.attr.customData.set('bullet_tint', { r: 50, g: 150, b: 255, a: 255 });
        this.attr.customData.set('bullet_scale', 1.1);
        this.attr.customData.set('bullet_trail', 'water');
    }

    protected _onHit(candidate: IQuadEntity): void {
        if (this._hasHit) return;
        this._hasHit = true;

        EventBus.emit('BULLET_HIT', {
            bulletId: this.id,
            enemyId: candidate.id,
            element: ElementType.WATER,
            damage: this.attr.damage,
            position: { x: this.node.position.x, y: this.node.position.y },
        });

        EventBus.emit('VFX_WATER_SPLASH', {
            position: { x: this.node.position.x, y: this.node.position.y },
            enemyId: candidate.id,
        });

        this._despawn();
    }
}
