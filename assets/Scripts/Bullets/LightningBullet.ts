/**
 * LightningBullet.ts
 *
 * 雷电弹子类
 *
 * 特性：
 * - 极快速度（500 px/s），弹体最小
 * - 命中时强制附着 LIGHTNING 状态
 * - 预留电击链传导初始坐标
 */

import { _decorator, Vec2 } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';
import { BaseBullet } from './BaseBullet';
import { IQuadEntity } from '../Core/Quadtree';

const { ccclass } = _decorator;

@ccclass('LightningBullet')
export class LightningBullet extends BaseBullet {
    private static readonly LIGHTNING_SPEED = 500;
    private static readonly LIGHTNING_RADIUS = 6;
    private static readonly LIGHTNING_DAMAGE = 12;
    private static readonly LIGHTNING_LIFETIME = 2.5;

    public init(
        id: string,
        position: import('cc').Vec3,
        direction: Vec2,
        element: ElementType,
        damage: number,
        speed: number,
        maxLifetime: number = 2.5,
    ): void {
        super.init(id, position, direction, ElementType.LIGHTNING, LightningBullet.LIGHTNING_DAMAGE, LightningBullet.LIGHTNING_SPEED, LightningBullet.LIGHTNING_LIFETIME);
        this.radius = LightningBullet.LIGHTNING_RADIUS;
        this.attr.customData.set('bullet_tint', { r: 100, g: 200, b: 255, a: 255 });
        this.attr.customData.set('bullet_scale', 0.7);
        this.attr.customData.set('bullet_trail', 'lightning');
        this.attr.customData.set('lightning_origin', {
            x: this.node.position.x,
            y: this.node.position.y,
        });
    }

    protected _onHit(candidate: IQuadEntity): void {
        if (this._hasHit) return;
        this._hasHit = true;

        const hitPos = { x: this.node.position.x, y: this.node.position.y };
        this.attr.customData.set('lightning_hit_pos', hitPos);

        EventBus.emit('BULLET_HIT', {
            bulletId: this.id,
            enemyId: candidate.id,
            element: ElementType.LIGHTNING,
            damage: this.attr.damage,
            position: hitPos,
        });

        EventBus.emit('VFX_LIGHTNING_STRIKE', {
            position: hitPos,
            enemyId: candidate.id,
            origin: this.attr.customData.get('lightning_origin'),
        });

        this._despawn();
    }
}
