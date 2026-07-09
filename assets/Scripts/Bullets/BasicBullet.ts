/**
 * BasicBullet.ts
 *
 * 纯物理子弹（无元素附着）
 *
 * 职责：
 * - 继承 BaseBullet，复用所有命中检测与对象池逻辑
 * - _onHitEffect 只派发 BULLET_HIT，不附加任何元素状态
 * - 不触发元素反应，不发射 VFX 事件
 */

import { _decorator } from 'cc';
import { BaseBullet } from './BaseBullet';
import { IQuadEntity } from '../Core/Quadtree';
import { EventBus } from '../Core/EventBus';
import { ElementType } from '../Core/ElementReactionHub';

const { ccclass } = _decorator;

@ccclass('BasicBullet')
export class BasicBullet extends BaseBullet {
    protected _onHitEffect(candidate: IQuadEntity): void {
        EventBus.emit('BULLET_HIT', {
            bulletId: this.id,
            enemyId: candidate.id,
            damage: this.attr.damage,
            element: ElementType.NONE,
            position: { x: this.node.position.x, y: this.node.position.y },
        });
        EventBus.emit('VFX_HIT_IMPACT', {
            position: { x: this.node.position.x, y: this.node.position.y },
        });
    }
}
