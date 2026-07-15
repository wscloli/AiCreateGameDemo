/**
 * WeaponSystem.ts
 *
 * 自动武器施法队列
 *
 * 职责：
 * - 维护动态施法序列（初始为空，肉鸽奖励逐步解锁）
 * - 无解锁元素时发射纯物理 BasicBullet
 * - 解锁后按选择顺序发射对应元素子弹
 * - 自动寻找最近的敌人，向该方向发射子弹
 * - 通过 BulletFactory 生成子弹
 * - 不挂载 Cocos update，由 GameLoop 调用 tick(dt)
 */

import { _decorator, Component, Vec2, Vec3 } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';
import { BulletFactory } from './BulletFactory';

const { ccclass, property } = _decorator;

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

    /** 攻击射程（像素）：只有敌人进入此范围才会发射 */
    @property
    public baseAttackRange: number = 350;
    public currentAttackRange: number = 350;

    /** 子弹最大存活时间 */
    @property
    public bulletLifetime: number = 3.0;

    /** 额外散射子弹数量 */
    public extraMultishot: number = 0;

    /** 动态施法序列（初始为空） */
    private _spellQueue: ElementType[] = [];

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
        EventBus.on('ADD_ELEMENT', this._onAddElement, this);
    }

    protected onDestroy(): void {
        EventBus.off('MODIFIER_FIRE_RATE_CHANGED', this._onFireRateChanged, this);
        EventBus.off('MODIFIER_DAMAGE_CHANGED', this._onDamageChanged, this);
        EventBus.off('MODIFIER_BULLET_SPEED_CHANGED', this._onBulletSpeedChanged, this);
        EventBus.off('MULTISHOT_CHANGED', this._onMultishotChanged, this);
        EventBus.off('ADD_ELEMENT', this._onAddElement, this);
    }

    // ────────────────────────────────
    //  GameLoop 驱动接口
    // ────────────────────────────────

    /**
     * 每帧由 GameLoop 调用
     * 累加冷却计时器，到点且射程内有敌人才发射
     */
    public tick(dt: number): void {
        this._fireTimer += dt;

        if (this._fireTimer >= this.currentFireInterval) {
            const target = this._findNearestEnemy();
            if (target && target.distance <= this.currentAttackRange) {
                this._fireTimer = 0;
                this._fire(target.direction);
            }
            // 射程内无敌人：保持 _fireTimer（不重置），等敌人进入射程立即发射
        }
    }

    // ────────────────────────────────
    //  核心逻辑
    // ────────────────────────────────

    private _fire(direction: Vec2): void {
        // 确定本次发射的元素：队列为空则用 NONE（BasicBullet）
        let element: ElementType = ElementType.NONE;
        if (this._spellQueue.length > 0) {
            element = this._spellQueue[this._queueIndex];
            this._queueIndex = (this._queueIndex + 1) % this._spellQueue.length;
        }

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

    /** 查找最近敌人，返回方向和距离 */
    private _findNearestEnemy(): { direction: Vec2; distance: number } | null {
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

        if (!nearestDir) return null;
        return { direction: nearestDir, distance: nearestDist };
    }

    // ────────────────────────────────
    //  事件回调
    // ────────────────────────────────

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

    private _onAddElement(payload: { element: ElementType }): void {
        this.addElementToQueue(payload.element);
    }

    // ────────────────────────────────
    //  公开接口（供 RoguelikeRewardSystem 调用）
    // ────────────────────────────────

    /**
     * 向施法队列追加一种元素（去重）
     */
    public addElementToQueue(element: ElementType): void {
        if (this._spellQueue.indexOf(element) !== -1) {
            console.warn(`[WeaponSystem] 元素 ${element} 已存在于队列中`);
            return;
        }
        this._spellQueue.push(element);
        console.log(`[WeaponSystem] 解锁元素: ${element}，当前队列: [${this._spellQueue.join(', ')}]`);
    }

    /**
     * 直接设置整个施法队列（覆盖，用于读档或调试）
     */
    public setElementQueue(elements: ElementType[]): void {
        this._spellQueue = [...elements];
        this._queueIndex = 0;
        console.log(`[WeaponSystem] 施法队列已设为: [${this._spellQueue.join(', ')}]`);
    }

    public getNextElement(): ElementType | null {
        if (this._spellQueue.length === 0) return null;
        return this._spellQueue[this._queueIndex];
    }

    public getQueueIndex(): number {
        return this._queueIndex;
    }

    public getQueueLength(): number {
        return this._spellQueue.length;
    }

    public resetQueue(): void {
        this._spellQueue = [];
        this._queueIndex = 0;
    }
}
