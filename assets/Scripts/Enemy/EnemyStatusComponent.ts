/**
 * EnemyStatusComponent.ts
 *
 * 挂载在怪物节点上的元素状态组件。
 * 不挂载 Cocos update，由 GameLoop 调用 tick(dt)。
 */

import { _decorator, Component, Vec3 } from 'cc';
import { ElementType, ElementReactionHub } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';
import { EnemyManager } from './EnemyManager';

const { ccclass } = _decorator;

const DEFAULT_ELEMENT_DURATION = 5.0;
const REACTION_EVENT_PREFIX = 'REACTION:';

export function getReactionEventName(reactionName: string): string {
    return `${REACTION_EVENT_PREFIX}${reactionName}`;
}

@ccclass('EnemyStatusComponent')
export class EnemyStatusComponent extends Component {
    /** 敌人碰撞半径（像素），用于互相排斥 */
    public static readonly COLLISION_RADIUS: number = 32;

    public enemyId: string = '';
    public activeElements: Map<ElementType, number> = new Map();
    public hp: number = 100;
    public maxHp: number = 100;
    public moveSpeed: number = 100;
    public scale: number = 1.0;
    public isStunned: boolean = false;

    private _stunTimer: number = 0;

    public get position(): { x: number; y: number } {
        const pos = this.node.position;
        return { x: pos.x, y: pos.y };
    }

    // ────────────────────────────────
    //  GameLoop 驱动接口（取代 Cocos update）
    // ────────────────────────────────

    public tick(dt: number): void {
        // 1. 元素倒计时衰减
        this._tickElementDecay(dt);

        // 2. 麻痹倒计时
        if (this.isStunned) {
            this._stunTimer -= dt;
            if (this._stunTimer <= 0) {
                this.isStunned = false;
                this._stunTimer = 0;
            }
            return; // 麻痹时无法移动
        }

        // 3. 向玩家移动 + 敌人互相排斥
        this._tickMoveToPlayer(dt);

        // 4. 预留视觉刷新
        this._refreshVisual();
    }

    // ────────────────────────────────
    //  核心接口
    // ────────────────────────────────

    public applyElement(newElement: ElementType): boolean {
        if (newElement === ElementType.NONE) return false;

        const result = ElementReactionHub.checkReaction(
            {
                id: this.enemyId,
                activeElements: new Set(this.activeElements.keys()),
                position: this.position,
            },
            newElement,
        );

        if (result) {
            for (const consumed of result.consumedElements) {
                if (consumed !== newElement) {
                    this.activeElements.delete(consumed);
                }
            }
            EventBus.emit(
                getReactionEventName(result.reactionName),
                {
                    enemyId: this.enemyId,
                    reaction: result,
                    position: this.position,
                    sourceComponent: this,
                },
            );
            return true;
        }

        this.activeElements.set(newElement, DEFAULT_ELEMENT_DURATION);
        EventBus.emit('ELEMENT_APPLIED', {
            enemyId: this.enemyId,
            element: newElement,
            position: this.position,
        });
        return false;
    }

    public takeDamage(damage: number): void {
        this.hp -= damage;
        if (this.hp <= 0) {
            this.hp = 0;
            EventBus.emit('ENEMY_DIED', {
                enemyId: this.enemyId,
                position: this.position,
            });
        }
    }

    public applyStun(duration: number): void {
        this.isStunned = true;
        this._stunTimer = Math.max(this._stunTimer, duration);
    }

    // ────────────────────────────────
    //  内部方法
    // ────────────────────────────────

    private _tickElementDecay(dt: number): void {
        const expiredElements: ElementType[] = [];
        for (const [element, remaining] of this.activeElements) {
            const newRemaining = remaining - dt;
            if (newRemaining <= 0) {
                expiredElements.push(element);
            } else {
                this.activeElements.set(element, newRemaining);
            }
        }
        for (const element of expiredElements) {
            this.activeElements.delete(element);
            EventBus.emit('ELEMENT_EXPIRED', {
                enemyId: this.enemyId,
                element,
                position: this.position,
            });
        }
    }

    private _tickMoveToPlayer(dt: number): void {
        let targetPos: { x: number; y: number } | null = null;
        EventBus.emit('QUERY_PLAYER_POSITION', (pos: { x: number; y: number; z: number }) => {
            targetPos = { x: pos.x, y: pos.y };
        });
        if (!targetPos) return;

        const pos = this.node.position;
        const dx = targetPos.x - pos.x;
        const dy = targetPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 基础朝向玩家的速度
        let vx = 0;
        let vy = 0;
        if (dist >= 1) {
            vx = (dx / dist) * this.moveSpeed;
            vy = (dy / dist) * this.moveSpeed;
        }

        // ── 敌人互相排斥（软碰撞） ──
        const myRadius = EnemyStatusComponent.COLLISION_RADIUS * this.scale;
        const enemies = EnemyManager.getAllEnemies();
        for (const [id, other] of enemies) {
            if (id === this.enemyId) continue;
            if (!other?.node?.isValid) continue;

            const ox = other.node.position.x - pos.x;
            const oy = other.node.position.y - pos.y;
            const oDist = Math.sqrt(ox * ox + oy * oy);
            const otherRadius = EnemyStatusComponent.COLLISION_RADIUS * other.scale;
            const minDist = myRadius + otherRadius;

            if (oDist < minDist && oDist > 0.1) {
                // 重叠量越大，排斥越强；加入软化因子避免抖动
                const overlap = minDist - oDist;
                const force = (overlap / minDist) * 600; // 600 px/s 最大排斥速度
                vx -= (ox / oDist) * force;
                vy -= (oy / oDist) * force;
            }
        }

        // 应用合速度
        this.node.setPosition(
            pos.x + vx * dt,
            pos.y + vy * dt,
            pos.z,
        );
    }

    private _refreshVisual(): void {
        // TODO: 根据 activeElements 混合颜色
    }

    public reset(enemyId: string, maxHp: number, moveSpeed: number): void {
        this.enemyId = enemyId;
        this.activeElements.clear();
        this.hp = maxHp;
        this.maxHp = maxHp;
        this.moveSpeed = moveSpeed;
        this.scale = 1.0;
        this.isStunned = false;
        this._stunTimer = 0;
    }
}
