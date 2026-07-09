/**
 * EnemyStatusComponent.ts
 *
 * 挂载在怪物节点上的元素状态组件。
 * 不挂载 Cocos update，由 GameLoop 调用 tick(dt)。
 */

import { _decorator, Component, Vec3, Sprite, Color, Node } from 'cc';
import { HPBar } from '../UI/HPBar';
import { ElementType, ElementReactionHub } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';
import { EnemyManager } from './EnemyManager';
import { EnvironmentManager } from '../Core/EnvironmentManager';
import { IEnemyAI, createEnemyAI, EnemyType } from './EnemyAI';

const ENEMY_TYPE_COLORS: Record<EnemyType, Color> = {
    [EnemyType.GRUNT]: new Color(220, 50, 50, 255),     // 红色
    [EnemyType.CHARGER]: new Color(255, 140, 0, 255),   // 橙色
    [EnemyType.FLANKER]: new Color(100, 220, 100, 255), // 绿色
    [EnemyType.TANK]: new Color(80, 80, 120, 255),      // 蓝灰色
    [EnemyType.RANGED]: new Color(200, 100, 200, 255),  // 紫色
};

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

    /** 攻击配置（由 EnemyManager 设置） */
    public attackDamage: number = 0;
    public attackRange: number = 0;
    public attackCooldown: number = 0;
    public attackType: 'MELEE' | 'RANGED' = 'MELEE';

    private _stunTimer: number = 0;
    private _ai: IEnemyAI | null = null;
    private _hpBarNode: Node | null = null;
    private _hpBar: HPBar | null = null;

    /** 攻击冷却计时器 */
    private _attackTimer: number = 0;
    /** 攻击动画剩余时间 */
    private _attackAnimTimer: number = 0;
    private readonly _ATTACK_ANIM_DURATION = 0.12;
    /** 攻击伤害延迟（先显示扇形，再造成伤害） */
    private _attackDelayTimer: number = -1;
    private readonly _ATTACK_DAMAGE_DELAY = 0.35;
    /** 延迟期间保存的伤害数据 */
    private _pendingDamage: number = 0;
    /** 保存当前敌人类型，用于攻击后恢复颜色 */
    private _currentType: EnemyType = EnemyType.GRUNT;
    /** 攻击前原始颜色缓存 */
    private _origColor: Color = new Color(255, 255, 255, 255);

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
            return; // 麻痹时无法移动/攻击
        }

        // 3. 向玩家移动 + 敌人互相排斥
        this._tickMoveToPlayer(dt);

        // 4. 攻击判定（触发扇形）
        this._tickAttack(dt);

        // 5. 攻击伤害延迟（扇形显示后才造成伤害）
        this._tickAttackDelay(dt);

        // 6. 攻击动画
        this._tickAttackAnim(dt);

        // 7. 预留视觉刷新
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
        this._hpBar?.setProgress(this.hp / this.maxHp);
        if (this.hp <= 0) {
            this.hp = 0;
            this._hpBar?.setVisible(false);
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

        // 查询环境效果（油洼减速等）
        const envEffect = EnvironmentManager.queryEffectAt(pos.x, pos.y);

        // AI 驱动基础速度
        let vx = 0;
        let vy = 0;
        if (this._ai) {
            const desired = this._ai.update(this, dt, targetPos);
            vx = desired.vx * envEffect.moveSpeedMultiplier;
            vy = desired.vy * envEffect.moveSpeedMultiplier;
        } else {
            // 默认直线追踪
            const dx = targetPos.x - pos.x;
            const dy = targetPos.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= 1) {
                vx = (dx / dist) * this.moveSpeed * envEffect.moveSpeedMultiplier;
                vy = (dy / dist) * this.moveSpeed * envEffect.moveSpeedMultiplier;
            }
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
                const overlap = minDist - oDist;
                const force = (overlap / minDist) * 600;
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
        this._ai = null;
        this._currentType = EnemyType.GRUNT;
        // 重置攻击状态
        this.attackDamage = 0;
        this.attackRange = 0;
        this.attackCooldown = 0;
        this.attackType = 'MELEE';
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._attackDelayTimer = -1;
        this._pendingDamage = 0;
        // 重置节点缩放（对象池复用会保留上一轮的 scale）
        this.node.setScale(1, 1, 1);
        // 重置颜色为默认红色（Grunt）
        const sp = this.node.getComponent(Sprite);
        if (sp) {
            sp.color = ENEMY_TYPE_COLORS[EnemyType.GRUNT];
        }
        // 初始化/重置生命条
        if (!this._hpBar) {
            this._hpBarNode = new Node('EnemyHPBar');
            this.node.addChild(this._hpBarNode);
            this._hpBar = this._hpBarNode.addComponent(HPBar);
            this._hpBar.init(false, 48, 40);
        } else {
            this._hpBar.reset();
        }
    }

    /** 设置攻击配置（由 EnemyManager.spawnEnemy 调用） */
    public setAttackConfig(damage: number, range: number, cooldown: number, type: 'MELEE' | 'RANGED'): void {
        this.attackDamage = damage;
        this.attackRange = range;
        this.attackCooldown = cooldown;
        this.attackType = type;
        this._attackTimer = cooldown * 0.5; // 初始随机冷却，避免同帧齐射
    }

    public setAI(type: EnemyType): void {
        this._currentType = type;
        this._ai = createEnemyAI(type);
        // 根据敌人类型切换视觉颜色
        const sp = this.node.getComponent(Sprite);
        if (sp) {
            sp.color = ENEMY_TYPE_COLORS[type] ?? ENEMY_TYPE_COLORS[EnemyType.GRUNT];
        }
    }

    // ────────────────────────────────
    //  攻击系统（纯 Sprite 反馈，方便替换美术）
    // ────────────────────────────────

    private _tickAttack(dt: number): void {
        if (this.attackDamage <= 0 || this.attackRange <= 0) {
            return;
        }

        let targetPos: { x: number; y: number } | null = null;
        EventBus.emit('QUERY_PLAYER_POSITION', (pos: { x: number; y: number; z: number }) => {
            targetPos = { x: pos.x, y: pos.y };
        });
        if (!targetPos) {
            return;
        }

        const pos = this.node.position;
        const dx = targetPos.x - pos.x;
        const dy = targetPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        this._attackTimer -= dt;

        if (dist <= this.attackRange && this._attackTimer <= 0) {
            // 触发攻击前摇
            this._attackTimer = this.attackCooldown;
            this._attackAnimTimer = this._ATTACK_ANIM_DURATION;
            this._attackDelayTimer = this._ATTACK_DAMAGE_DELAY;
            this._pendingDamage = this.attackDamage;

            // 计算朝向玩家的角度（用于扇形特效）
            const angle = Math.atan2(dy, dx);

            // 发射扇形攻击特效（先显示）
            EventBus.emit('VFX_ENEMY_ATTACK', {
                position: { x: pos.x, y: pos.y },
                angle,
                radius: this.attackRange,
            });

            // 播放攻击视觉反馈
            this._playAttackVisual();
        }
    }

    /** 延迟造成伤害 */
    private _tickAttackDelay(dt: number): void {
        if (this._attackDelayTimer < 0) return;
        this._attackDelayTimer -= dt;
        if (this._attackDelayTimer <= 0) {
            this._attackDelayTimer = -1;
            // 延迟结束，造成伤害
            EventBus.emit('PLAYER_DAMAGE', {
                damage: this._pendingDamage,
                sourceId: this.enemyId,
                sourceType: this.attackType,
                position: this.position,
            });
            this._pendingDamage = 0;
        }
    }

    /** 攻击瞬间的 Sprite 反馈：闪白 + 放大（后续替换美术资源后自然生效） */
    private _playAttackVisual(): void {
        const sp = this.node.getComponent(Sprite);
        if (!sp) return;
        const c = sp.color;
        this._origColor.set(c.r, c.g, c.b, c.a);
        sp.color = new Color(255, 255, 255, 255); // 闪白
        this.node.setScale(this.scale * 1.25, this.scale * 1.25, 1);
    }

    private _tickAttackAnim(dt: number): void {
        if (this._attackAnimTimer <= 0) return;
        this._attackAnimTimer -= dt;
        if (this._attackAnimTimer <= 0) {
            // 恢复颜色和缩放
            const sp = this.node.getComponent(Sprite);
            if (sp) {
                sp.color = ENEMY_TYPE_COLORS[this._currentType] ?? this._origColor;
            }
            this.node.setScale(this.scale, this.scale, 1);
        }
    }
}
