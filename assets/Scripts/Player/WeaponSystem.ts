/**
 * WeaponSystem.ts
 *
 * 自动武器施法队列
 *
 * 职责：
 * - 维护固定施法序列 [OIL → FIRE → LIGHTNING → WATER → 循环]
 * - 自动寻找最近的敌人，向该方向发射子弹
 * - 通过 BulletFactory 生成子弹
 * - 不挂载 Cocos update，由 GameLoop 调用 tick(dt)
 */

import { _decorator, Component, Vec2, Vec3 } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';
import { BulletFactory } from './BulletFactory';

const { ccclass, property } = _decorator;

/** 施法序列 */
const SPELL_QUEUE: ElementType[] = [
    ElementType.OIL,
    ElementType.FIRE,
    ElementType.LIGHTNING,
    ElementType.WATER,
];

@ccclass('WeaponSystem')
export class WeaponSystem extends Component {
    // ────────────────────────────────
    //  属性
    // ────────────────────────────────

    /** 基础发射间隔（秒） */
    @property
    public baseFireInterval: number = 0.6;

    /** 当前发射间隔（受修改器影响） */
    public currentFireInterval: number = 0.6;

    /** 子弹基础伤害 */
    @property
    public baseDamage: number = 10;

    /** 当前伤害（受修改器影响） */
    public currentDamage: number = 10;

    /** 子弹基础速度 */
    @property
    public baseSpeed: number = 350;

    /** 当前子弹速度（受修改器影响） */
    public currentSpeed: number = 350;

    /** 子弹最大存活时间 */
    @property
    public bulletLifetime: number = 3.0;

    /** 额外散射子弹数量 */
    public extraMultishot: number = 0;

    /** 当前序列索引 */
    private _queueIndex: number = 0;

    /** 发射计时器 */
    private _fireTimer: number = 0;

    // ────────────────────────────────
    //  生命周期
    // ────────────────────────────────

    protected onLoad(): void {
        EventBus.on('MODIFIER_FIRE_RATE_CHANGED', this._onFireRateChanged, this);
        EventBus.on('MODIFIER_DAMAGE_CHANGED', this._onDamageChanged, this);
        EventBus.on('MODIFIER_BULLET_SPEED_CHANGED', this._onBulletSpeedChanged, this);
        EventBus.on('MULTISHOT_CHANGED', this._onMultishotChanged, this);
    }

    protected onDestroy(): void {
        EventBus.off('MODIFIER_FIRE_RATE_CHANGED', this._onFireRateChanged, this);
        EventBus.off('MODIFIER_DAMAGE_CHANGED', this._onDamageChanged, this);
        EventBus.off('MODIFIER_BULLET_SPEED_CHANGED', this._onBulletSpeedChanged, this);
        EventBus.off('MULTISHOT_CHANGED', this._onMultishotChanged, this);
    }

    // ────────────────────────────────
    //  GameLoop 驱动接口
    // ────────────────────────────────

    /**
     * 每帧由 GameLoop 调用
     * 累加冷却计时器，到点发射
     */
    public tick(dt: number): void {
        this._fireTimer += dt;

        if (this._fireTimer >= this.currentFireInterval) {
            this._fireTimer = 0;
            this._fire();
        }
    }

    // ────────────────────────────────
    //  核心逻辑
    // ────────────────────────────────

    private _fire(): void {
        const element = SPELL_QUEUE[this._queueIndex];
        this._queueIndex = (this._queueIndex + 1) % SPELL_QUEUE.length;

        const direction = this._findNearestEnemyDirection();
        if (!direction) return;

        // 主弹
        BulletFactory.spawnBullet({
            position: this.node.position.clone(),
            direction,
            element,
            damage: this.currentDamage,
            speed: this.currentSpeed,
            maxLifetime: this.bulletLifetime,
        });

        // 散射弹（如果有 multishot）
        if (this.extraMultishot > 0) {
            const baseAngle = Math.atan2(direction.y, direction.x);
            const spreadStep = Math.PI / 8; // 22.5° 间隔
            const startOffset = -((this.extraMultishot - 1) * spreadStep) / 2;

            for (let i = 0; i < this.extraMultishot; i++) {
                const angle = baseAngle + startOffset + spreadStep * i;
                const spreadDir = new Vec2(Math.cos(angle), Math.sin(angle));
                BulletFactory.spawnBullet({
                    position: this.node.position.clone(),
                    direction: spreadDir,
                    element,
                    damage: this.currentDamage,
                    speed: this.currentSpeed,
                    maxLifetime: this.bulletLifetime,
                });
            }
        }
    }

    private _findNearestEnemyDirection(): Vec2 | null {
        let nearestDir: Vec2 | null = null;
        let nearestDist = Infinity;

        EventBus.emit('QUERY_ENEMY_POSITIONS', (enemies: { x: number; y: number }[]) => {
            const playerPos = this.node.position;

            for (const enemy of enemies) {
                const dx = enemy.x - playerPos.x;
                const dy = enemy.y - playerPos.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestDir = new Vec2(dx, dy);
                }
            }
        });

        return nearestDir;
    }

    private _onFireRateChanged(multiplier: number): void {
        this.currentFireInterval = this.baseFireInterval * multiplier;
    }

    private _onDamageChanged(multiplier: number): void {
        this.currentDamage = Math.floor(this.baseDamage * multiplier);
    }

    private _onBulletSpeedChanged(multiplier: number): void {
        this.currentSpeed = this.baseSpeed * multiplier;
    }

    private _onMultishotChanged(payload: { extraBullets: number }): void {
        this.extraMultishot = payload.extraBullets;
    }

    // ────────────────────────────────
    //  公开接口
    // ────────────────────────────────

    public getNextElement(): ElementType {
        return SPELL_QUEUE[this._queueIndex];
    }

    public getQueueIndex(): number {
        return this._queueIndex;
    }

    public resetQueue(): void {
        this._queueIndex = 0;
    }
}
