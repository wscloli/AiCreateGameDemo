/**
 * ReactionProcessor.ts
 *
 * 战场"终结者"——反应事件处理器。
 *
 * 职责：
 * - 初始化时监听 EventBus 上所有反应事件
 * - 针对不同反应类型执行纯数据层的伤害/控制/融合逻辑
 * - 所有碰撞检测基于 Vec2.distance，零 Physics2D 依赖
 * - 通过 EventBus 派发视觉/特效事件，与渲染层解耦
 */

import { _decorator, Component, Vec2, Vec3 } from 'cc';
import { EventBus } from '../Core/EventBus';
import { ElementType, ElementReactionHub, ReactionResult } from '../Core/ElementReactionHub';
import { EnemyStatusComponent, getReactionEventName } from './EnemyStatusComponent';

const { ccclass } = _decorator;

/** 反应事件回调参数结构 */
export interface ReactionEventPayload {
    enemyId: string;
    reaction: ReactionResult;
    position: { x: number; y: number };
    sourceComponent: EnemyStatusComponent;
}

/**
 * ReactionProcessor
 *
 * 设计为 cc.Component，挂载在场景持久节点上。
 * 也可作为纯静态类使用（通过 ReactionProcessor.init() 调用）。
 */
@ccclass('ReactionProcessor')
export class ReactionProcessor extends Component {
    // ────────────────────────────────
    //  常量
    // ────────────────────────────────

    /** FIRE_EXPLOSION 爆炸半径（像素） */
    private static readonly EXPLOSION_RADIUS = 150;

    /** FIRE_EXPLOSION 伤害倍率 */
    private static readonly EXPLOSION_DAMAGE_MULTIPLIER = 2.0;

    /** LIGHTNING_CONDUCT 传导半径（像素） */
    private static readonly CONDUCT_RADIUS = 200;

    /** LIGHTNING_CONDUCT 最大传导目标数 */
    private static readonly CONDUCT_MAX_TARGETS = 5;

    /** LIGHTNING_CONDUCT 麻痹持续时间（秒） */
    private static readonly STUN_DURATION = 2.0;

    /** LIGHTNING_CONDUCT 传导伤害倍率 */
    private static readonly CONDUCT_DAMAGE_MULTIPLIER = 1.5;

    /** 所有敌人状态组件的引用缓存（由 EnemyManager 注册） */
    private static _enemyComponents: Map<string, EnemyStatusComponent> = new Map();

    /** 是否已初始化 */
    private static _initialized = false;

    // ────────────────────────────────
    //  生命周期
    // ────────────────────────────────

    protected onLoad(): void {
        ReactionProcessor.init();
    }

    protected onDestroy(): void {
        ReactionProcessor._unregisterAllEvents();
        ReactionProcessor._initialized = false;
    }

    // ────────────────────────────────
    //  初始化
    // ────────────────────────────────

    /**
     * 初始化：注册所有反应事件的监听
     */
    public static init(): void {
        if (ReactionProcessor._initialized) return;

        // 注册已知反应事件
        const reactions = ElementReactionHub.getRegisteredReactions();
        for (const reactionName of reactions) {
            const eventName = getReactionEventName(reactionName);
            EventBus.on(eventName, ReactionProcessor._onReaction, ReactionProcessor);
        }

        // 注册未知反应的兜底（后续动态添加的反应也能被捕获）
        // 通过通配监听所有 REACTION: 前缀的事件
        // 但为了性能，此处仅注册已知反应；动态反应需单独注册

        ReactionProcessor._initialized = true;
        console.log('[ReactionProcessor] 初始化完成，已注册反应:', reactions.join(', '));
    }

    // ────────────────────────────────
    //  敌人注册
    // ────────────────────────────────

    /**
     * 注册敌人状态组件（由 EnemyManager 在 spawn 时调用）
     */
    public static registerEnemy(component: EnemyStatusComponent): void {
        ReactionProcessor._enemyComponents.set(component.enemyId, component);
    }

    /**
     * 注销敌人状态组件（由 EnemyManager 在 despawn 时调用）
     */
    public static unregisterEnemy(enemyId: string): void {
        ReactionProcessor._enemyComponents.delete(enemyId);
    }

    /**
     * 获取所有敌人组件（只读快照）
     */
    public static getAllEnemies(): Map<string, EnemyStatusComponent> {
        return ReactionProcessor._enemyComponents;
    }

    // ────────────────────────────────
    //  事件路由
    // ────────────────────────────────

    /**
     * 反应事件统一入口
     */
    private static _onReaction(payload: ReactionEventPayload): void {
        switch (payload.reaction.reactionName) {
            case 'FIRE_EXPLOSION':
                ReactionProcessor._handleFireExplosion(payload);
                break;

            case 'LIGHTNING_CONDUCT':
                ReactionProcessor._handleLightningConduct(payload);
                break;

            case 'MAGNETIC_PULL':
                ReactionProcessor._handleMagneticPull(payload);
                break;

            case 'MONSTER_MERGE':
                ReactionProcessor._handleMonsterMerge(payload);
                break;

            default:
                console.warn(`[ReactionProcessor] 未知反应类型: ${payload.reaction.reactionName}`);
                break;
        }
    }

    // ────────────────────────────────
    //  反应处理：FIRE_EXPLOSION（烈火燎原）
    // ────────────────────────────────

    /**
     * 火油大爆炸：
     * - 纯 Vec2.distance 计算爆炸范围内所有敌人
     * - 造成 200% 范围火焰伤害
     * - 移除受影响敌人的 OIL 状态（被引爆）
     */
    private static _handleFireExplosion(payload: ReactionEventPayload): void {
        const { position, reaction } = payload;
        const baseDamage = 50; // 基础爆炸伤害，后续可由子弹伤害传入
        const finalDamage = baseDamage * reaction.damageMultiplier;

        // 遍历所有敌人，纯数学距离判定
        for (const [enemyId, enemy] of ReactionProcessor._enemyComponents) {
            const dist = Vec2.distance(
                new Vec2(position.x, position.y),
                new Vec2(enemy.position.x, enemy.position.y),
            );

            if (dist <= ReactionProcessor.EXPLOSION_RADIUS) {
                // 距离越近伤害越高（线性衰减）
                const distanceFactor = 1 - (dist / ReactionProcessor.EXPLOSION_RADIUS) * 0.5;
                const actualDamage = finalDamage * distanceFactor;

                enemy.takeDamage(actualDamage);

                // 移除 OIL 状态（被火焰引爆消耗）
                enemy.activeElements.delete(ElementType.OIL);

                // 移除 FIRE 状态（爆炸后火焰消散）
                enemy.activeElements.delete(ElementType.FIRE);
            }
        }

        // 派发视觉事件（特效系统监听）
        EventBus.emit('VFX_EXPLOSION', {
            position,
            radius: ReactionProcessor.EXPLOSION_RADIUS,
            damage: finalDamage,
        });

        console.log(`[ReactionProcessor] FIRE_EXPLOSION @ (${position.x.toFixed(0)}, ${position.y.toFixed(0)}) 半径=${ReactionProcessor.EXPLOSION_RADIUS}`);
    }

    // ────────────────────────────────
    //  反应处理：LIGHTNING_CONDUCT（感电过载）
    // ────────────────────────────────

    /**
     * 感电过载：
     * - 找到附近带有 WATER 状态的敌人
     * - 在它们之间形成电击链传导
     * - 施加伤害 + 麻痹效果
     */
    private static _handleLightningConduct(payload: ReactionEventPayload): void {
        const { position, reaction, sourceComponent } = payload;
        const baseDamage = 30;
        const finalDamage = baseDamage * reaction.damageMultiplier;

        // 收集附近带有 WATER 状态的敌人
        const waterTargets: EnemyStatusComponent[] = [];

        for (const [, enemy] of ReactionProcessor._enemyComponents) {
            if (enemy.enemyId === payload.enemyId) continue; // 跳过触发者

            const dist = Vec2.distance(
                new Vec2(position.x, position.y),
                new Vec2(enemy.position.x, enemy.position.y),
            );

            if (dist <= ReactionProcessor.CONDUCT_RADIUS && enemy.activeElements.has(ElementType.WATER)) {
                waterTargets.push(enemy);
            }
        }

        // 限制传导目标数
        const targets = waterTargets.slice(0, ReactionProcessor.CONDUCT_MAX_TARGETS);

        // 对触发者本身也造成伤害
        sourceComponent.takeDamage(finalDamage);
        sourceComponent.applyStun(ReactionProcessor.STUN_DURATION);

        // 对传导目标造成递减伤害
        for (let i = 0; i < targets.length; i++) {
            const chainFactor = 1 - (i / targets.length) * 0.4; // 链式衰减：100% → 60%
            const chainDamage = finalDamage * chainFactor;

            targets[i].takeDamage(chainDamage);
            targets[i].applyStun(ReactionProcessor.STUN_DURATION * chainFactor);

            // 消耗目标的 WATER 状态（导电后蒸发）
            targets[i].activeElements.delete(ElementType.WATER);
        }

        // 派发视觉事件
        EventBus.emit('VFX_LIGHTNING_CHAIN', {
            origin: position,
            targets: targets.map(t => t.position),
            damage: finalDamage,
        });

        console.log(`[ReactionProcessor] LIGHTNING_CONDUCT 传导 ${targets.length} 个目标`);
    }

    // ────────────────────────────────
    //  反应处理：MAGNETIC_PULL（等离子聚怪）
    // ────────────────────────────────

    /**
     * 等离子聚怪：
     * - 生成一个微型引力黑洞
     * - 将附近敌人向黑洞中心拉扯
     * - 造成轻微伤害
     */
    private static _handleMagneticPull(payload: ReactionEventPayload): void {
        const { position, reaction } = payload;
        const pullRadius = 250;
        const pullForce = 200; // 拉扯速度 px/s
        const baseDamage = 20;
        const finalDamage = baseDamage * reaction.damageMultiplier;

        const pulledEnemies: string[] = [];

        for (const [enemyId, enemy] of ReactionProcessor._enemyComponents) {
            const dist = Vec2.distance(
                new Vec2(position.x, position.y),
                new Vec2(enemy.position.x, enemy.position.y),
            );

            if (dist <= pullRadius && dist > 5) {
                // 计算拉扯方向（指向黑洞中心）
                const dirX = (position.x - enemy.position.x) / dist;
                const dirY = (position.y - enemy.position.y) / dist;

                // 距离越近拉力越强
                const distanceFactor = 1 - (dist / pullRadius) * 0.5;
                const force = pullForce * distanceFactor;

                // 直接修改敌人位置（通过 node）
                // 注意：这里需要获取敌人的 node 引用
                // 实际实现时 EnemyStatusComponent 应暴露 setPosition 方法
                const node = enemy.node;
                if (node) {
                    const currentPos = node.position;
                    node.setPosition(
                        currentPos.x + dirX * force * 0.016, // 假设 60fps 的 dt
                        currentPos.y + dirY * force * 0.016,
                        currentPos.z,
                    );
                }

                // 造成轻微伤害
                enemy.takeDamage(finalDamage * distanceFactor);
                pulledEnemies.push(enemyId);
            }
        }

        // 派发视觉事件
        EventBus.emit('VFX_MAGNETIC_PULL', {
            position,
            radius: pullRadius,
            pulledCount: pulledEnemies.length,
        });

        console.log(`[ReactionProcessor] MAGNETIC_PULL 拉扯 ${pulledEnemies.length} 个敌人`);
    }

    // ────────────────────────────────
    //  反应处理：MONSTER_MERGE（怪物融合）
    // ────────────────────────────────

    /**
     * 怪物融合：
     * - 将触发者与最近的另一个 GLUE 状态怪融合
     * - 属性叠加：HP、伤害、体型
     * - 移速取平均值
     */
    private static _handleMonsterMerge(payload: ReactionEventPayload): void {
        const { sourceComponent, position } = payload;

        // 寻找最近的带有 GLUE 状态的敌人
        let nearestEnemy: EnemyStatusComponent | null = null;
        let nearestDist = Infinity;

        for (const [, enemy] of ReactionProcessor._enemyComponents) {
            if (enemy.enemyId === sourceComponent.enemyId) continue;

            if (enemy.activeElements.has(ElementType.GLUE)) {
                const dist = Vec2.distance(
                    new Vec2(position.x, position.y),
                    new Vec2(enemy.position.x, enemy.position.y),
                );

                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestEnemy = enemy;
                }
            }
        }

        if (!nearestEnemy) {
            console.warn('[ReactionProcessor] MONSTER_MERGE 未找到可融合目标');
            return;
        }

        // ── 执行融合 ──

        // 1. HP 叠加
        const mergedHp = sourceComponent.hp + nearestEnemy.hp;
        const mergedMaxHp = sourceComponent.maxHp + nearestEnemy.maxHp;

        // 2. 体型叠加
        const mergedScale = sourceComponent.scale + nearestEnemy.scale * 0.5;

        // 3. 移速取平均
        const mergedSpeed = (sourceComponent.moveSpeed + nearestEnemy.moveSpeed) / 2;

        // 4. 元素状态合并（去重）
        for (const [element, remaining] of nearestEnemy.activeElements) {
            if (!sourceComponent.activeElements.has(element)) {
                sourceComponent.activeElements.set(element, remaining);
            } else {
                // 相同元素取最大剩余时间
                const current = sourceComponent.activeElements.get(element)!;
                if (remaining > current) {
                    sourceComponent.activeElements.set(element, remaining);
                }
            }
        }

        // 5. 应用融合后属性到 sourceComponent
        sourceComponent.hp = mergedHp;
        sourceComponent.maxHp = mergedMaxHp;
        sourceComponent.scale = mergedScale;
        sourceComponent.moveSpeed = mergedSpeed;

        // 6. 消耗 GLUE 状态
        sourceComponent.activeElements.delete(ElementType.GLUE);

        // 7. 移除被融合的敌人（触发死亡流程）
        nearestEnemy.takeDamage(nearestEnemy.hp); // 强制死亡

        // 派发视觉事件
        EventBus.emit('VFX_MONSTER_MERGE', {
            targetId: sourceComponent.enemyId,
            consumedId: nearestEnemy.enemyId,
            newScale: mergedScale,
            position: sourceComponent.position,
        });

        console.log(`[ReactionProcessor] MONSTER_MERGE: ${sourceComponent.enemyId} + ${nearestEnemy.enemyId} → HP=${mergedHp}, 体型=${mergedScale.toFixed(2)}`);
    }

    // ────────────────────────────────
    //  清理
    // ────────────────────────────────

    /**
     * 注销所有事件监听
     */
    private static _unregisterAllEvents(): void {
        const reactions = ElementReactionHub.getRegisteredReactions();
        for (const reactionName of reactions) {
            const eventName = getReactionEventName(reactionName);
            EventBus.off(eventName, ReactionProcessor._onReaction, ReactionProcessor);
        }
        ReactionProcessor._enemyComponents.clear();
    }

    /**
     * 重置（测试用）
     */
    public static reset(): void {
        ReactionProcessor._unregisterAllEvents();
        ReactionProcessor._initialized = false;
    }
}
