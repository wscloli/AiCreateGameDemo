/**
 * BulletFactory.ts
 *
 * 子弹工厂 - 负责从对象池取弹、注入修饰器链、注册到四叉树。
 *
 * 职责：
 * - 根据元素类型从 PoolManager 获取对应的子弹子类实例
 * - 根据当前肉鸽修改器配置注入 ModifierManager
 * - 将子弹注册到 Quadtree
 * - 维护子弹 ID 生成
 */

import { _decorator, Component, Vec2, Vec3 } from 'cc';
import { ElementType } from '../Core/ElementReactionHub';
import { PoolManager } from '../Core/PoolManager';
import { Quadtree } from '../Core/Quadtree';
import { BaseBullet } from '../Bullets/BaseBullet';
import { BasicBullet } from '../Bullets/BasicBullet';
import { OilBullet } from '../Bullets/OilBullet';
import { FireBullet } from '../Bullets/FireBullet';
import { LightningBullet } from '../Bullets/LightningBullet';
import { WaterBullet } from '../Bullets/WaterBullet';
import { EnemyStatusComponent } from '../Enemy/EnemyStatusComponent';
import {
    BulletModifier,
    BoomerangModifier,
    OrbitModifier,
} from './BulletModifier';

const { ccclass } = _decorator;

/** 子弹生成配置 */
export interface BulletSpawnConfig {
    position: Vec3;
    direction: Vec2;
    element: ElementType;
    damage: number;
    speed: number;
    maxLifetime?: number;
}

/** 元素类型 → 子弹类映射 */
const ELEMENT_BULLET_CLASS: Record<string, new () => BaseBullet> = {
    [ElementType.NONE]: BasicBullet,
    [ElementType.OIL]: OilBullet,
    [ElementType.FIRE]: FireBullet,
    [ElementType.LIGHTNING]: LightningBullet,
    [ElementType.WATER]: WaterBullet,
};

@ccclass('BulletFactory')
export class BulletFactory extends Component {
    private static _bulletIdCounter: number = 0;
    private static _quadtree: Quadtree | null = null;
    private static _globalModifiers: BulletModifier[] = [];
    private static _bulletClasses: (new () => BaseBullet)[] = [];

    /** 修饰器注册表（肉鸽奖励动态添加） */
    private static _modifierRegistry: Map<string, () => BulletModifier> = new Map();

    // ────────────────────────────────
    //  初始化
    // ────────────────────────────────

    public static init(quadtree: Quadtree): void {
        BulletFactory._quadtree = quadtree;

        // 注册内置修饰器
        BulletFactory._modifierRegistry.set('Boomerang', () => new BoomerangModifier());
        BulletFactory._modifierRegistry.set('Orbit', () => new OrbitModifier(80, 3.0, 0));

        // 注册所有元素子弹的对象池（不预生成，模板节点由外部注入后再手动 prewarm）
        BulletFactory._bulletClasses = [BasicBullet, OilBullet, FireBullet, LightningBullet, WaterBullet];
        for (const cls of BulletFactory._bulletClasses) {
            PoolManager.registerPool(cls, 0);
        }

        console.log('[BulletFactory] 初始化完成，已注册 4 种子弹池');
    }

    /** 回收所有活跃子弹 */
    public static despawnAllBullets(): void {
        for (const cls of BulletFactory._bulletClasses) {
            PoolManager.despawnAll(cls);
        }
    }

    // ────────────────────────────────
    //  修饰器管理
    // ────────────────────────────────

    public static registerModifier(name: string, factory: () => BulletModifier): void {
        BulletFactory._modifierRegistry.set(name, factory);
    }

    public static addGlobalModifier(name: string): boolean {
        const factory = BulletFactory._modifierRegistry.get(name);
        if (!factory) {
            console.warn(`[BulletFactory] 未注册的修饰器: "${name}"`);
            return false;
        }
        const existing = BulletFactory._globalModifiers.findIndex(m => m.name === name);
        if (existing !== -1) {
            BulletFactory._globalModifiers[existing] = factory();
        } else {
            BulletFactory._globalModifiers.push(factory());
        }
        console.log(`[BulletFactory] 添加全局修饰器: "${name}"`);
        return true;
    }

    public static removeGlobalModifier(name: string): void {
        const idx = BulletFactory._globalModifiers.findIndex(m => m.name === name);
        if (idx !== -1) {
            BulletFactory._globalModifiers.splice(idx, 1);
        }
    }

    public static clearGlobalModifiers(): void {
        BulletFactory._globalModifiers.length = 0;
    }

    // ────────────────────────────────
    //  子弹生成
    // ────────────────────────────────

    /**
     * 根据元素类型生成对应的子弹
     */
    public static spawnBullet(config: BulletSpawnConfig): BaseBullet | null {
        if (!BulletFactory._quadtree) {
            console.error('[BulletFactory] 未初始化');
            return null;
        }

        // 1. 根据元素类型选择子弹类
        const bulletClass = ELEMENT_BULLET_CLASS[config.element];
        if (!bulletClass) {
            console.warn(`[BulletFactory] 未知元素类型: ${config.element}`);
            return null;
        }

        // 2. 从对应对象池取实例
        const bullet = PoolManager.spawn(bulletClass);

        // 3. 生成唯一 ID
        const bulletId = `bullet_${++BulletFactory._bulletIdCounter}`;

        // 4. 初始化（子类复写的 init 会自动设置元素专属参数）
        bullet.init(
            bulletId,
            config.position,
            config.direction,
            config.element,
            config.damage,
            config.speed,
            config.maxLifetime ?? 5.0,
        );

        // 5. 注入四叉树引用
        bullet.quadtree = BulletFactory._quadtree;

        // 6. 注入全局修饰器链
        for (const modifier of BulletFactory._globalModifiers) {
            const factory = BulletFactory._modifierRegistry.get(modifier.name);
            if (factory) {
                bullet.modifierManager.add(factory());
            }
        }

        // 7. 注册到四叉树
        BulletFactory._quadtree.insert(bullet);

        return bullet;
    }

    /**
     * 批量生成子弹
     */
    public static spawnBullets(configs: BulletSpawnConfig[]): BaseBullet[] {
        return configs
            .map(cfg => BulletFactory.spawnBullet(cfg))
            .filter((b): b is BaseBullet => b !== null);
    }
}

