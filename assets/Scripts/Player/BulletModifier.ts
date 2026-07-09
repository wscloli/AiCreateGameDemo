/**
 * BulletModifier.ts
 *
 * 子弹运行时核心数据接口 + 形态修饰器基类 + 具体修饰器实现。
 *
 * 设计原则：
 * - 修饰器只篡改 IBulletAttribute 的物理/运动字段，不碰元素类型
 * - 多个修饰器通过链式组合（reduce）叠加，无冲突、无限叠加
 * - 所有计算基于纯数学，零渲染依赖
 */

import { Vec2, Vec3 } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';

// ────────────────────────────────────────
//  子弹运行时核心数据接口
// ────────────────────────────────────────

/**
 * IBulletAttribute
 *
 * 子弹在每一帧的完整运行时快照。
 * 修饰器链通过修改此对象来改变子弹行为。
 */
export interface IBulletAttribute {
    /** 基础伤害值 */
    damage: number;

    /** 移动速度（标量，单位 px/s） */
    speed: number;

    /** 当前帧速度向量（方向 + 速率，每帧由修饰器链重算） */
    velocity: Vec2;

    /** 子弹携带的元素类型 */
    element: ElementType;

    /** 子弹已存活时间（秒） */
    lifetime: number;

    /** 修饰器临时数据集。
     *  各修饰器可在此读写私有状态，互不干扰。
     *  例：BoomerangModifier 写入 { boomerang_hasReturned: true } */
    customData: Map<string, any>;
}

// ────────────────────────────────────────
//  形态修饰器基类
// ────────────────────────────────────────

/**
 * BulletModifier（抽象基类）
 *
 * 每个修饰器是一个纯函数式单元：
 * - 输入：当前帧的 IBulletAttribute + 帧时间 dt
 * - 输出：通过修改 attr 引用完成副作用
 *
 * 多个修饰器通过 ModifierManager 链式调用，顺序叠加。
 */
export abstract class BulletModifier {
    /** 修饰器唯一标识（用于去重和调试） */
    public abstract readonly name: string;

    /**
     * 每帧由 ModifierManager 调用。
     * 子类重写此方法以篡改 attr 的物理/运动字段。
     *
     * @param attr  当前帧子弹属性（可读写）
     * @param dt    帧时间（秒）
     */
    public abstract update(attr: IBulletAttribute, dt: number): void;
}

// ────────────────────────────────────────
//  具体修饰器实现
// ────────────────────────────────────────

/**
 * BoomerangModifier
 *
 * 回旋镖效果（命中反弹版）：
 * - 飞出阶段（FLY_OUT）：子弹正常飞行，直到命中第一个敌人
 * - 命中后触发弹回（BOUNCE_BACK）：子弹朝玩家方向折返，期间可命中其他敌人
 * - 返航阶段（RETURNING）：继续朝玩家飞行，回到玩家身边后由 BaseBullet 销毁
 *
 * 与 OrbitModifier 兼容性说明：
 * - 若同时存在 OrbitModifier，OrbitModifier 每帧重写 velocity，
 *   BoomerangModifier 的返航速度会被覆盖。
 *   此时表现为"命中后切换为环绕轨道"，视觉上仍可接受。
 */
export class BoomerangModifier extends BulletModifier {
    public readonly name = 'Boomerang';

    /** 弹回速度倍率（相对于原速度） */
    private readonly _bounceSpeedMul: number = 1.2;

    /** 当前阶段：0=飞出 1=弹回/返航 */
    private _phase: 0 | 1 = 0;

    /** 已命中过的敌人 ID 集合（防止同一敌人被连续命中两次） */
    private _hitEnemyIds: Set<string> = new Set();

    /** 是否已触发过弹回 */
    public get hasBounced(): boolean { return this._phase === 1; }

    /** 返回已命中的敌人 ID 集合（只读） */
    public get hitEnemyIds(): ReadonlySet<string> { return this._hitEnemyIds; }

    public update(attr: IBulletAttribute, _dt: number): void {
        // 只有弹回阶段才干预 velocity
        if (this._phase === 0) return;

        // 获取玩家当前位置
        let playerPos: { x: number; y: number } | null = null;
        EventBus.emit('QUERY_PLAYER_POSITION', (pos: Vec3) => {
            playerPos = { x: pos.x, y: pos.y };
        });
        if (!playerPos) return;

        const currentPos = attr.customData.get('currentPos') as { x: number; y: number } | undefined;
        if (!currentPos) return;

        // 计算朝向玩家的方向
        const dx = playerPos.x - currentPos.x;
        const dy = playerPos.y - currentPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
            const speed = attr.speed * this._bounceSpeedMul;
            attr.velocity.x = (dx / dist) * speed;
            attr.velocity.y = (dy / dist) * speed;
        }
    }

    /**
     * 触发弹回（由 BaseBullet._onHit 调用）
     * @param enemyId 被命中的敌人 ID
     * @returns 是否是首次命中该敌人（ true = 确实触发了弹回）
     */
    public triggerBounce(enemyId: string): boolean {
        if (this._hitEnemyIds.has(enemyId)) return false;
        this._hitEnemyIds.add(enemyId);
        this._phase = 1;
        return true;
    }

    /**
     * 判断弹回子弹是否应该销毁（回到玩家身边）
     * @param currentPos 子弹当前位置
     * @returns true = 应该销毁
     */
    public shouldDespawn(currentPos: { x: number; y: number }): boolean {
        if (this._phase === 0) return false;

        let playerPos: { x: number; y: number } | null = null;
        EventBus.emit('QUERY_PLAYER_POSITION', (pos: Vec3) => {
            playerPos = { x: pos.x, y: pos.y };
        });
        if (!playerPos) return false;

        const dx = playerPos.x - currentPos.x;
        const dy = playerPos.y - currentPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= 40;
    }

    /** 重置状态（对象池回收时调用） */
    public reset(): void {
        this._phase = 0;
        this._hitEnemyIds.clear();
    }
}

/**
 * OrbitModifier
 *
 * 环绕卫星效果：
 * - 忽略外部 velocity，根据自增角度 + 固定半径强制计算轨道位置
 * - 角度每帧递增，形成持续环绕运动
 * - 半径和角速度可通过 customData 调节
 *
 * 与 BoomerangModifier 兼容性：
 * - 当两个修饰器共存时，OrbitModifier 每帧重写 velocity，
 *   BoomerangModifier 的取反不会生效。
 * - 但 BoomerangModifier 的 boomerang_triggered 标记可作为信号：
 *   OrbitModifier 可在折返触发后增大半径或加速旋转，产生"回旋卫星"效果。
 */
export class OrbitModifier extends BulletModifier {
    public readonly name = 'Orbit';

    /** 环绕半径（px） */
    private readonly _radius: number;

    /** 角速度（弧度/秒） */
    private readonly _angularSpeed: number;

    /** 初始角度偏移（弧度） */
    private readonly _initialAngle: number;

    constructor(radius: number = 80, angularSpeed: number = 3.0, initialAngle: number = 0) {
        super();
        this._radius = radius;
        this._angularSpeed = angularSpeed;
        this._initialAngle = initialAngle;
    }

    public update(attr: IBulletAttribute, dt: number): void {
        // 1. 获取玩家当前位置（作为轨道中心）
        let playerPos: { x: number; y: number } | null = null;
        EventBus.emit('QUERY_PLAYER_POSITION', (pos: Vec3) => {
            playerPos = { x: pos.x, y: pos.y };
        });
        if (!playerPos) return;

        // 2. 读取或初始化当前角度（首次以玩家→子弹的连线方向为基准）
        let currentAngle = attr.customData.get('orbit_angle') as number | undefined;
        if (currentAngle === undefined) {
            const currentPos = attr.customData.get('currentPos') as { x: number; y: number } | undefined;
            if (currentPos) {
                currentAngle = Math.atan2(currentPos.y - playerPos.y, currentPos.x - playerPos.x);
            } else {
                currentAngle = this._initialAngle;
            }
        }

        // 3. 角度递增
        currentAngle += this._angularSpeed * dt;

        // 4. Boomerang 联动
        const boomerangTriggered = attr.customData.get('boomerang_triggered') === true;
        const effectiveRadius = boomerangTriggered ? this._radius * 1.5 : this._radius;
        const effectiveSpeed = boomerangTriggered ? this._angularSpeed * 1.8 : this._angularSpeed;
        if (boomerangTriggered) {
            currentAngle += (this._angularSpeed * 0.8) * dt;
        }

        // 5. 计算轨道目标位置（以玩家为中心）
        const cos = Math.cos(currentAngle);
        const sin = Math.sin(currentAngle);
        const targetX = playerPos.x + effectiveRadius * cos;
        const targetY = playerPos.y + effectiveRadius * sin;

        // 6. 让子弹朝目标位置移动
        //    velocity = delta / dt，BaseBullet.tick 中 pos += velocity * dt 后正好到达 target
        const currentPos = attr.customData.get('currentPos') as { x: number; y: number } | undefined;
        if (currentPos && dt > 0) {
            attr.velocity.x = (targetX - currentPos.x) / dt;
            attr.velocity.y = (targetY - currentPos.y) / dt;
        } else {
            // 第一帧还没有 currentPos，用切向速度启动
            attr.velocity.x = -effectiveRadius * sin * effectiveSpeed;
            attr.velocity.y = effectiveRadius * cos * effectiveSpeed;
        }

        // 保存更新后的角度
        attr.customData.set('orbit_angle', currentAngle);

        // 标记该子弹正在环绕
        attr.customData.set('is_orbiting', true);
    }
}

/**
 * ModifierManager
 *
 * 修饰器链容器。
 * 管理一组 BulletModifier，每帧按序执行 update，实现链式叠加。
 */
export class ModifierManager {
    private _modifiers: BulletModifier[] = [];

    /**
     * 注册一个修饰器（自动去重：同名修饰器只保留最后一个）
     */
    public add(modifier: BulletModifier): void {
        const existingIndex = this._modifiers.findIndex(m => m.name === modifier.name);
        if (existingIndex !== -1) {
            this._modifiers[existingIndex] = modifier;
        } else {
            this._modifiers.push(modifier);
        }
    }

    /**
     * 是否包含指定名称的修饰器
     */
    public has(name: string): boolean {
        return this._modifiers.some(m => m.name === name);
    }

    /**
     * 获取指定名称的修饰器（类型断言由调用方负责）
     */
    public get<T extends BulletModifier>(name: string): T | null {
        return this._modifiers.find(m => m.name === name) as T | null;
    }

    /**
     * 移除指定名称的修饰器
     */
    public remove(name: string): void {
        const idx = this._modifiers.findIndex(m => m.name === name);
        if (idx !== -1) {
            this._modifiers.splice(idx, 1);
        }
    }

    /**
     * 清空所有修饰器
     */
    public clear(): void {
        this._modifiers.length = 0;
    }

    /**
     * 获取当前修饰器列表（只读）
     */
    public get modifiers(): ReadonlyArray<BulletModifier> {
        return this._modifiers;
    }

    /**
     * 获取修饰器数量
     */
    public get count(): number {
        return this._modifiers.length;
    }

    /**
     * 每帧调用：按注册顺序链式执行所有修饰器的 update
     *
     * @param attr  子弹属性（每个修饰器依次读写同一引用）
     * @param dt    帧时间
     */
    public updateAll(attr: IBulletAttribute, dt: number): void {
        for (const modifier of this._modifiers) {
            modifier.update(attr, dt);
        }
    }
}
