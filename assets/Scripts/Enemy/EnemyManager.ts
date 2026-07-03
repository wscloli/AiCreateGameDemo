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

        // 吸收盾检测
        if (config?.elementResist?.includes(payload.element)) {
            enemy.hp = Math.min(enemy.hp + payload.damage * 0.5, enemy.maxHp);
            enemy.scale += 0.1;
            enemy.node.setScale(enemy.scale, enemy.scale, 1);
            EventBus.emit('ENEMY_ABSORBED', {
                enemyId: payload.enemyId,
                element: payload.element,
                position: enemy.position,
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

        // 触发反应判定
        const hasReaction = enemy.applyElement(payload.element);
        if (!hasReaction) {
            enemy.takeDamage(payload.damage);
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
            const config: EnemyConfig = {
                maxHp: 30 + waveNumber * 10,
                moveSpeed: 50 + waveNumber * 5,
            };
            EnemyManager.spawnEnemy(config, pos);
        }

        console.log(`[EnemyManager] 第 ${waveNumber} 波开始，生成 ${enemyCount} 个敌人`);
    }

    public static get currentWave(): number { return EnemyManager._currentWave; }
    public static get aliveCount(): number { return EnemyManager._enemies.size; }
    public static getAllEnemies(): Map<string, EnemyStatusComponent> { return EnemyManager._enemies; }
    public static getEnemyConfig(enemyId: string): EnemyConfig | undefined {
        return EnemyManager._enemyConfigs.get(enemyId);
    }
}

