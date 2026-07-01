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

import { Vec2 } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';

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
 * 回旋镖效果：
 * - 飞出阶段（lifetime < 0.5s）：正常飞行
 * - 折返阶段（lifetime >= 0.5s 且未折返过）：velocity 取反
 * - 折返后不再干预 velocity，由其他修饰器或默认逻辑接管
 *
 * 与 OrbitModifier 兼容性说明：
 * - 若同时存在 OrbitModifier，OrbitModifier 会在每帧重写 velocity，
 *   因此 BoomerangModifier 的取反效果会被覆盖。
 *   解决方案：在 customData 中标记 boomerang_triggered，
 *   OrbitModifier 可据此调整轨道相位（180° 翻转），实现"回旋镖环绕"。
 */
export class BoomerangModifier extends BulletModifier {
    public readonly name = 'Boomerang';

    /** 折返触发时间阈值（秒） */
    private readonly _returnTime: number = 0.5;

    public update(attr: IBulletAttribute, dt: number): void {
        // 累加存活时间
        attr.lifetime += dt;

        // 已触发过折返，不再干预
        if (attr.customData.get('boomerang_triggered') === true) {
            return;
        }

        // 达到折返阈值 → velocity 取反
        if (attr.lifetime >= this._returnTime) {
            attr.velocity.x *= -1;
            attr.velocity.y *= -1;

            // 标记已折返
            attr.customData.set('boomerang_triggered', true);

            // 可选：折返后加速，增强手感
            attr.speed *= 1.3;
        }
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
        // 累加存活时间
        attr.lifetime += dt;

        // 从 customData 读取或初始化当前角度
        let currentAngle = attr.customData.get('orbit_angle') as number | undefined;
        if (currentAngle === undefined) {
            currentAngle = this._initialAngle;
        }

        // 角度递增
        currentAngle += this._angularSpeed * dt;

        // 检测 BoomerangModifier 的折返标记，动态调整轨道
        const boomerangTriggered = attr.customData.get('boomerang_triggered') === true;
        const effectiveRadius = boomerangTriggered ? this._radius * 1.5 : this._radius;
        const effectiveSpeed = boomerangTriggered ? this._angularSpeed * 1.8 : this._angularSpeed;

        // 重新计算角度（使用调整后的角速度）
        if (boomerangTriggered) {
            currentAngle += (this._angularSpeed * 0.8) * dt; // 额外加速增量
        }

        // 强制重写 velocity 为轨道切向向量
        // 轨道位置 = (radius * cos(angle), radius * sin(angle))
        // 切向速度 = (-radius * sin(angle), radius * cos(angle)) * angularSpeed
        const cos = Math.cos(currentAngle);
        const sin = Math.sin(currentAngle);

        attr.velocity.x = -effectiveRadius * sin * effectiveSpeed;
        attr.velocity.y = effectiveRadius * cos * effectiveSpeed;

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
