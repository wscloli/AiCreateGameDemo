/**
 * EnemyManager.ts
 *
 * 敌人管理器 - 波次调度 + 敌人生成/回收 + 四叉树注册
 *
 * 职责：
 * - 监听 BULLET_HIT 事件，将子弹命中路由到对应 EnemyStatusComponent.applyElement
 * - 管理所有敌人的生命周期（spawn/despawn）
 * - 维护敌人与四叉树的同步
 * - 不挂载 Cocos update，由 GameLoop 调用 tick(dt)
 */

import { _decorator, Component, Vec3, Node } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { EventBus } from '../Core/EventBus';
import { PoolManager } from '../Core/PoolManager';
import { Quadtree, IQuadEntity } from '../Core/Quadtree';
import { EnemyStatusComponent } from './EnemyStatusComponent';
import { ReactionProcessor } from './ReactionProcessor';
import { EnvironmentManager } from '../Core/EnvironmentManager';

const { ccclass, property } = _decorator;

interface BulletHitPayload {
    bulletId: string;
    enemyId: string;
    element: ElementType;
    damage: number;
    position: { x: number; y: number };
}

export interface EnemyConfig {
    maxHp: number;
    moveSpeed: number;
    elementResist?: ElementType[];
    isSlime?: boolean;
    damageThreshold?: number;
    enemyType?: string; // 'GRUNT' | 'CHARGER' | 'FLANKER' | 'TANK' | 'RANGED'
    /** 攻击伤害 */
    attackDamage?: number;
    /** 攻击范围（像素） */
    attackRange?: number;
    /** 攻击冷却（秒） */
    attackCooldown?: number;
    /** 攻击类型：近战 / 远程（预留） */
    attackType?: 'MELEE' | 'RANGED';
}

@ccclass('EnemyManager')
export class EnemyManager extends Component {
    private static _instance: EnemyManager | null = null;
    private static _quadtree: Quadtree | null = null;
    private static _enemies: Map<string, EnemyStatusComponent> = new Map();
    private static _enemyConfigs: Map<string, EnemyConfig> = new Map();
    private static _enemyQuadEntities: Map<string, IQuadEntity> = new Map();
    private static _enemyIdCounter: number = 0;
    private static _currentWave: number = 0;

    // ────────────────────────────────
    //  生命周期
    // ────────────────────────────────

    protected onLoad(): void {
        EnemyManager._instance = this;
        EventBus.on('BULLET_HIT', EnemyManager._onBulletHit, this);
        EventBus.on('ENEMY_DIED', EnemyManager._onEnemyDied, this);
        console.log('[EnemyManager] 初始化完成');
    }

    protected onDestroy(): void {
        EventBus.off('BULLET_HIT', EnemyManager._onBulletHit, this);
        EventBus.off('ENEMY_DIED', EnemyManager._onEnemyDied, this);
        EnemyManager._instance = null;
    }

    // ────────────────────────────────
    //  GameLoop 驱动接口
    // ────────────────────────────────

    /**
     * 每帧由 GameLoop 调用
     * 更新四叉树中的敌人位置
     */
    public static tick(dt: number): void {
        // 每帧重建四叉树：清空后按敌人当前位置重新插入
        // 解决敌人跨越象限边界后四叉树查不到的问题
        if (!EnemyManager._quadtree) return;
        EnemyManager._quadtree.clear();
        for (const [enemyId, component] of EnemyManager._enemies) {
            if (!component?.node?.isValid) continue;
            const pos = component.node.position;
            const entity = EnemyManager._enemyQuadEntities.get(enemyId);
            if (entity) {
                entity.x = pos.x;
                entity.y = pos.y;
                EnemyManager._quadtree.insert(entity);
            }
        }
    }

    // ────────────────────────────────
    //  初始化
    // ────────────────────────────────

    public static init(quadtree: Quadtree): void {
        EnemyManager._quadtree = quadtree;

        // 注册敌人对象池（不预生成，模板节点由外部注入后再手动 prewarm）
        PoolManager.registerPool(EnemyStatusComponent, 0);
    }

    // ────────────────────────────────
    //  敌人生成/回收
    // ────────────────────────────────

    public static spawnEnemy(config: EnemyConfig, position: Vec3): EnemyStatusComponent | null {
        if (!EnemyManager._quadtree) {
            console.error('[EnemyManager] 未初始化四叉树');
            return null;
        }

        const enemy = PoolManager.spawn(EnemyStatusComponent);
        const enemyId = `enemy_${++EnemyManager._enemyIdCounter}`;

        enemy.node.setPosition(position);
        enemy.reset(enemyId, config.maxHp, config.moveSpeed);

        if (config.enemyType) {
            enemy.setAI(config.enemyType as any);
        }

        // 设置攻击配置（无条件调用，config 中无值时用默认值兜底）
        enemy.setAttackConfig(
            config.attackDamage ?? 5,
            config.attackRange ?? 120,
            config.attackCooldown ?? 1.2,
            config.attackType ?? 'MELEE',
        );

        EnemyManager._enemyConfigs.set(enemyId, config);
        ReactionProcessor.registerEnemy(enemy);

        const quadEntity: IQuadEntity = {
            id: enemyId,
            x: position.x,
            y: position.y,
            radius: 20,
        };
        EnemyManager._quadtree.insert(quadEntity);
        EnemyManager._enemyQuadEntities.set(enemyId, quadEntity);
        EnemyManager._enemies.set(enemyId, enemy);

        EventBus.emit('ENEMY_SPAWNED', {
            enemyId,
            position: { x: position.x, y: position.y },
            config,
        });

        return enemy;
    }

    public static despawnEnemy(enemyId: string): void {
        const enemy = EnemyManager._enemies.get(enemyId);
        if (!enemy) return;

        if (EnemyManager._quadtree) {
            EnemyManager._quadtree.remove(enemyId);
        }
        ReactionProcessor.unregisterEnemy(enemyId);

        EnemyManager._enemies.delete(enemyId);
        EnemyManager._enemyConfigs.delete(enemyId);
        EnemyManager._enemyQuadEntities.delete(enemyId);

        PoolManager.despawn(enemy);
    }

    public static despawnAll(): void {
        const enemyIds = Array.from(EnemyManager._enemies.keys());
        for (const id of enemyIds) {
            EnemyManager.despawnEnemy(id);
        }
    }

    // ────────────────────────────────
    //  事件处理
    // ────────────────────────────────

    private static _onBulletHit(payload: BulletHitPayload): void {
        const enemy = EnemyManager._enemies.get(payload.enemyId);
        if (!enemy) return;

        const config = EnemyManager._enemyConfigs.get(payload.enemyId);

        // 元素抗性检测（减伤 50%，不再回血）
        if (config?.elementResist?.length && config.elementResist.indexOf(payload.element) !== -1) {
            const reducedDamage = Math.floor(payload.damage * 0.5);
            enemy.takeDamage(reducedDamage);
            EventBus.emit('ENEMY_RESISTED', {
                enemyId: payload.enemyId,
                element: payload.element,
                position: enemy.position,
                reducedDamage,
            });
            return;
        }

        // 增殖史莱姆检测
        if (config?.isSlime && config?.damageThreshold) {
            if (payload.damage < config.damageThreshold) {
                EnemyManager._splitSlime(payload.enemyId, payload.damage);
                return;
            }
        }

        // 环境区域效果查询
        const envEffect = EnvironmentManager.queryEffectAt(enemy.position.x, enemy.position.y);

        // 触发反应判定（先应用子弹元素）
        const hasReaction = enemy.applyElement(payload.element);
        if (!hasReaction) {
            // 无反应时，应用环境伤害倍率
            const finalDamage = Math.floor(payload.damage * envEffect.damageTakenMultiplier);
            enemy.takeDamage(finalDamage);
        }

        // 环境自动附加元素（如水池自动附水）
        if (envEffect.autoApplyElement) {
            // 延迟一帧附加，避免同一帧内重复反应
            setTimeout(() => {
                const currentEnemy = EnemyManager._enemies.get(payload.enemyId);
                if (currentEnemy) {
                    currentEnemy.applyElement(envEffect.autoApplyElement!);
                }
            }, 0);
        }
    }

    private static _onEnemyDied(payload: { enemyId: string; position: { x: number; y: number } }): void {
        EnemyManager.despawnEnemy(payload.enemyId);
    }

    // ────────────────────────────────
    //  增殖史莱姆分裂
    // ────────────────────────────────

    private static _splitSlime(enemyId: string, incomingDamage: number): void {
        const enemy = EnemyManager._enemies.get(enemyId);
        const config = EnemyManager._enemyConfigs.get(enemyId);
        if (!enemy || !config) return;

        const pos = enemy.node.position;
        const offsets = [new Vec3(-30, 0, 0), new Vec3(30, 0, 0)];

        for (const offset of offsets) {
            const childConfig: EnemyConfig = {
                ...config,
                maxHp: Math.max(config.maxHp * 0.5, 10),
                damageThreshold: config.damageThreshold! * 1.2,
            };
            EnemyManager.spawnEnemy(
                childConfig,
                new Vec3(pos.x + offset.x, pos.y + offset.y, pos.z),
            );
        }

        EventBus.emit('VFX_SLIME_SPLIT', {
            position: { x: pos.x, y: pos.y },
            count: 2,
        });

        enemy.takeDamage(enemy.hp);
    }

    // ────────────────────────────────
    //  波次调度
    // ────────────────────────────────

    public static startWave(waveNumber: number): void {
        EnemyManager._currentWave = waveNumber;
        EventBus.emit('WAVE_START', { wave: waveNumber });

        const enemyCount = 5 + waveNumber * 3;
        for (let i = 0; i < enemyCount; i++) {
            const angle = (Math.PI * 2 * i) / enemyCount;
            const radius = 400 + Math.random() * 200;
            const pos = new Vec3(
                Math.cos(angle) * radius,
                Math.sin(angle) * radius,
                0,
            );
            const config = EnemyManager._buildEnemyConfig(waveNumber, i, enemyCount);
            EnemyManager.spawnEnemy(config, pos);
        }

        console.log(`[EnemyManager] 第 ${waveNumber} 波开始，生成 ${enemyCount} 个敌人`);
    }

    /**
     * 根据波次和索引构建敌人配置（混合敌人类型）
     */
    private static _buildEnemyConfig(waveNumber: number, index: number, total: number): EnemyConfig {
        const baseHp = 30 + waveNumber * 10;
        const baseSpeed = 50 + waveNumber * 5;
        const attackDamage = 5 + waveNumber * 2;
        const attackRange = 120; // 增大攻击范围，确保能打到玩家
        const attackCooldown = 1.2;

        // 第 1 波：全普通怪
        if (waveNumber === 1) {
            return {
                maxHp: baseHp,
                moveSpeed: baseSpeed,
                enemyType: 'GRUNT',
                attackDamage,
                attackRange,
                attackCooldown,
                attackType: 'MELEE',
            };
        }

        // 从第 2 波开始引入多样化
        const r = Math.random();

        // 坦克怪：第 3 波起，低概率
        if (waveNumber >= 3 && r < 0.15) {
            return {
                maxHp: baseHp * 2.5,
                moveSpeed: baseSpeed * 0.4,
                enemyType: 'TANK',
                elementResist: [ElementType.FIRE, ElementType.OIL],
                attackDamage: attackDamage * 1.5,
                attackRange: 80,
                attackCooldown: 1.8,
                attackType: 'MELEE',
            };
        }

        // 冲锋怪：第 2 波起，中等概率
        if (waveNumber >= 2 && r < 0.35) {
            return {
                maxHp: baseHp,
                moveSpeed: baseSpeed * 1.3,
                enemyType: 'CHARGER',
                attackDamage: attackDamage * 1.2,
                attackRange,
                attackCooldown: 1.0,
                attackType: 'MELEE',
            };
        }

        // 迂回怪：第 4 波起，中等概率
        if (waveNumber >= 4 && r < 0.55) {
            return {
                maxHp: baseHp * 0.8,
                moveSpeed: baseSpeed * 1.1,
                enemyType: 'FLANKER',
                attackDamage,
                attackRange,
                attackCooldown: 0.9,
                attackType: 'MELEE',
            };
        }

        // 默认普通怪
        return {
            maxHp: baseHp,
            moveSpeed: baseSpeed,
            enemyType: 'GRUNT',
            attackDamage,
            attackRange,
            attackCooldown,
            attackType: 'MELEE',
        };
    }

    public static get currentWave(): number { return EnemyManager._currentWave; }
    public static get aliveCount(): number { return EnemyManager._enemies.size; }
    public static getAllEnemies(): Map<string, EnemyStatusComponent> { return EnemyManager._enemies; }
    public static getEnemyConfig(enemyId: string): EnemyConfig | undefined {
        return EnemyManager._enemyConfigs.get(enemyId);
    }
}

