/**
 * RoguelikeRewardSystem.ts
 *
 * 肉鸽修改器奖励系统
 *
 * 职责：
 * - 监听波次完成事件，生成 3 个可选修改器
 * - 管理玩家已选修改器（持久化到整局游戏）
 * - 提供随机抽取池（普通/稀有/传说 3 个稀有度）
 * - 通过 EventBus 通知 UI 层显示选择面板
 * - 应用选中修改器到 WeaponSystem / BulletFactory / PlayerController
 */

import { _decorator, Component } from 'cc';
import { EventBus } from '../Core/EventBus';
import { BulletFactory } from './BulletFactory';
import { BulletModifier, BoomerangModifier, OrbitModifier } from './BulletModifier';

const { ccclass } = _decorator;

/** 修改器稀有度 */
export enum ModifierRarity {
    COMMON = 'COMMON',     // 普通 70%
    RARE = 'RARE',         // 稀有 25%
    LEGENDARY = 'LEGENDARY', // 传说 5%
}

/** 修改器效果类型 */
export enum ModifierEffectType {
    /** 攻速提升 */
    FIRE_RATE_UP = 'FIRE_RATE_UP',
    /** 伤害提升 */
    DAMAGE_UP = 'DAMAGE_UP',
    /** 子弹速度提升 */
    BULLET_SPEED_UP = 'BULLET_SPEED_UP',
    /** 添加 Boomerang 修饰器 */
    ADD_BOOMERANG = 'ADD_BOOMERANG',
    /** 添加 Orbit 修饰器 */
    ADD_ORBIT = 'ADD_ORBIT',
    /** 增加子弹数量（散射） */
    MULTISHOT = 'MULTISHOT',
    /** 子弹穿透（暂时未实现，预留） */
    PIERCE = 'PIERCE',
    /** 拾取范围提升（预留） */
    PICKUP_RANGE_UP = 'PICKUP_RANGE_UP',
}

/** 单个修改器定义 */
export interface ModifierDef {
    id: string;
    name: string;
    description: string;
    rarity: ModifierRarity;
    effectType: ModifierEffectType;
    /** 效果数值（根据类型解释） */
    value: number;
    /** 可叠加次数（0=无限） */
    maxStack: number;
    /** 图标标识（UI 使用） */
    icon: string;
}

/** 已选修改器实例 */
export interface ActiveModifier {
    def: ModifierDef;
    stackCount: number;
}

/** 奖励选项 */
export interface RewardOption {
    index: number;
    modifier: ModifierDef;
}

@ccclass('RoguelikeRewardSystem')
export class RoguelikeRewardSystem extends Component {
    private static _instance: RoguelikeRewardSystem | null = null;

    /** 当前持有的所有修改器 */
    private static _activeModifiers: Map<string, ActiveModifier> = new Map();

    /** 当前波次是否正在等待玩家选择 */
    private static _isAwaitingChoice: boolean = false;

    /** 当前提供的选项（选择期间有效） */
    private static _currentOptions: RewardOption[] = [];

    /** 累计抽取次数（用于保底机制） */
    private static _totalDraws: number = 0;

    // ────────────────────────────────
    //  修改器卡池定义
    // ────────────────────────────────

    private static readonly _modifierPool: ModifierDef[] = [
        // 普通
        { id: 'fire_rate_1', name: '快速施法', description: '攻击速度 +15%', rarity: ModifierRarity.COMMON, effectType: ModifierEffectType.FIRE_RATE_UP, value: 0.85, maxStack: 5, icon: 'icon_fire_rate' },
        { id: 'damage_1', name: '元素强化', description: '子弹伤害 +20%', rarity: ModifierRarity.COMMON, effectType: ModifierEffectType.DAMAGE_UP, value: 1.20, maxStack: 5, icon: 'icon_damage' },
        { id: 'bullet_speed_1', name: '疾风之翼', description: '子弹速度 +20%', rarity: ModifierRarity.COMMON, effectType: ModifierEffectType.BULLET_SPEED_UP, value: 1.20, maxStack: 5, icon: 'icon_speed' },
        { id: 'multishot_1', name: '双重施法', description: '每次发射 +1 发子弹', rarity: ModifierRarity.COMMON, effectType: ModifierEffectType.MULTISHOT, value: 1, maxStack: 3, icon: 'icon_multishot' },

        // 稀有
        { id: 'boomerang_1', name: '回旋秘术', description: '子弹获得回旋镖效果', rarity: ModifierRarity.RARE, effectType: ModifierEffectType.ADD_BOOMERANG, value: 1, maxStack: 1, icon: 'icon_boomerang' },
        { id: 'orbit_1', name: '卫星轨道', description: '子弹获得环绕效果', rarity: ModifierRarity.RARE, effectType: ModifierEffectType.ADD_ORBIT, value: 1, maxStack: 1, icon: 'icon_orbit' },
        { id: 'fire_rate_2', name: '极速咏唱', description: '攻击速度 +30%', rarity: ModifierRarity.RARE, effectType: ModifierEffectType.FIRE_RATE_UP, value: 0.70, maxStack: 3, icon: 'icon_fire_rate' },
        { id: 'damage_2', name: '元素过载', description: '子弹伤害 +40%', rarity: ModifierRarity.RARE, effectType: ModifierEffectType.DAMAGE_UP, value: 1.40, maxStack: 3, icon: 'icon_damage' },

        // 传说
        { id: 'multishot_2', name: '弹幕风暴', description: '每次发射 +3 发子弹', rarity: ModifierRarity.LEGENDARY, effectType: ModifierEffectType.MULTISHOT, value: 3, maxStack: 1, icon: 'icon_multishot' },
        { id: 'pierce_1', name: '贯穿之光', description: '子弹可穿透 3 个敌人', rarity: ModifierRarity.LEGENDARY, effectType: ModifierEffectType.PIERCE, value: 3, maxStack: 1, icon: 'icon_pierce' },
    ];

    protected onLoad(): void {
        RoguelikeRewardSystem._instance = this;
        EventBus.on('WAVE_COMPLETE', RoguelikeRewardSystem._onWaveComplete, this);
    }

    protected onDestroy(): void {
        EventBus.off('WAVE_COMPLETE', RoguelikeRewardSystem._onWaveComplete, this);
        RoguelikeRewardSystem._instance = null;
    }

    // ────────────────────────────────
    //  核心逻辑
    // ────────────────────────────────

    /**
     * 波次完成 → 暂停游戏并生成奖励选项
     */
    private static _onWaveComplete(payload: { wave: number }): void {
        if (RoguelikeRewardSystem._isAwaitingChoice) return;

        RoguelikeRewardSystem._isAwaitingChoice = true;
        const options = RoguelikeRewardSystem._drawOptions(3);
        RoguelikeRewardSystem._currentOptions = options.map((mod, idx) => ({ index: idx, modifier: mod }));

        // 通知 UI 显示选择面板
        EventBus.emit('REWARD_SHOW', {
            wave: payload.wave,
            options: RoguelikeRewardSystem._currentOptions,
        });

        // 暂停游戏逻辑（GameLoop 仍运行但暂停波次生成和敌人行动）
        EventBus.emit('GAME_PAUSE', { reason: 'REWARD_SELECTION' });

        console.log(`[RoguelikeRewardSystem] 第 ${payload.wave} 波奖励就绪，等待选择...`);
    }

    /**
     * 玩家选择了某个修改器（由 UI 层调用）
     */
    public static selectOption(index: number): boolean {
        if (!RoguelikeRewardSystem._isAwaitingChoice) {
            console.warn('[RoguelikeRewardSystem] 当前无待选奖励');
            return false;
        }

        const option = RoguelikeRewardSystem._currentOptions.find(o => o.index === index);
        if (!option) {
            console.warn(`[RoguelikeRewardSystem] 无效选项索引: ${index}`);
            return false;
        }

        RoguelikeRewardSystem._applyModifier(option.modifier);
        RoguelikeRewardSystem._isAwaitingChoice = false;
        RoguelikeRewardSystem._currentOptions = [];

        // 恢复游戏
        EventBus.emit('GAME_RESUME', { reason: 'REWARD_SELECTION' });
        EventBus.emit('REWARD_SELECTED', { modifier: option.modifier });

        console.log(`[RoguelikeRewardSystem] 已选择: ${option.modifier.name}`);
        return true;
    }

    /**
     * 随机抽取 N 个选项（不重复，考虑已持有和最大堆叠）
     */
    private static _drawOptions(count: number): ModifierDef[] {
        const available = RoguelikeRewardSystem._getAvailableModifiers();
        if (available.length === 0) {
            // 没有可用修改器时，全给金币/回血（简化处理：给伤害+10%保底）
            return Array.from({ length: count }, () => RoguelikeRewardSystem._modifierPool.find(m => m.id === 'damage_1')!);
        }

        // 按稀有度加权随机
        const result: ModifierDef[] = [];
        const usedIds = new Set<string>();

        for (let i = 0; i < count; i++) {
            const pool = available.filter(m => !usedIds.has(m.id));
            if (pool.length === 0) break;

            const mod = RoguelikeRewardSystem._weightedRandom(pool);
            if (mod) {
                result.push(mod);
                usedIds.add(mod.id);
            }
        }

        // 保底机制：每 10 抽至少出现 1 个稀有
        RoguelikeRewardSystem._totalDraws += count;
        if (result.every(m => m.rarity === ModifierRarity.COMMON) && RoguelikeRewardSystem._totalDraws >= 10) {
            const rarePool = available.filter(m => m.rarity !== ModifierRarity.COMMON && !usedIds.has(m.id));
            if (rarePool.length > 0) {
                result[result.length - 1] = RoguelikeRewardSystem._weightedRandom(rarePool)!;
                RoguelikeRewardSystem._totalDraws = 0;
            }
        }

        return result;
    }

    /**
     * 获取当前可用的修改器池（排除已满堆叠的）
     */
    private static _getAvailableModifiers(): ModifierDef[] {
        return RoguelikeRewardSystem._modifierPool.filter(def => {
            const active = RoguelikeRewardSystem._activeModifiers.get(def.id);
            if (!active) return true;
            if (def.maxStack === 0) return true; // 0 = 无限叠加
            return active.stackCount < def.maxStack;
        });
    }

    /**
     * 加权随机抽取
     */
    private static _weightedRandom(pool: ModifierDef[]): ModifierDef | null {
        const weights: Record<ModifierRarity, number> = {
            [ModifierRarity.COMMON]: 70,
            [ModifierRarity.RARE]: 25,
            [ModifierRarity.LEGENDARY]: 5,
        };

        const totalWeight = pool.reduce((sum, m) => sum + weights[m.rarity], 0);
        let roll = Math.random() * totalWeight;

        for (const mod of pool) {
            roll -= weights[mod.rarity];
            if (roll <= 0) return mod;
        }

        return pool[pool.length - 1] ?? null;
    }

    /**
     * 应用修改器到对应系统
     */
    private static _applyModifier(def: ModifierDef): void {
        // 记录到已激活列表
        const existing = RoguelikeRewardSystem._activeModifiers.get(def.id);
        if (existing) {
            existing.stackCount++;
        } else {
            RoguelikeRewardSystem._activeModifiers.set(def.id, { def, stackCount: 1 });
        }

        // 根据效果类型分发
        switch (def.effectType) {
            case ModifierEffectType.FIRE_RATE_UP:
                RoguelikeRewardSystem._recalcFireRate();
                break;
            case ModifierEffectType.DAMAGE_UP:
                RoguelikeRewardSystem._recalcDamage();
                break;
            case ModifierEffectType.BULLET_SPEED_UP:
                RoguelikeRewardSystem._recalcBulletSpeed();
                break;
            case ModifierEffectType.ADD_BOOMERANG:
                BulletFactory.addGlobalModifier('Boomerang');
                break;
            case ModifierEffectType.ADD_ORBIT:
                BulletFactory.addGlobalModifier('Orbit');
                break;
            case ModifierEffectType.MULTISHOT:
                // 由 WeaponSystem 监听 MULTISHOT_CHANGED 事件
                EventBus.emit('MULTISHOT_CHANGED', {
                    extraBullets: RoguelikeRewardSystem._getTotalMultishot(),
                });
                break;
            case ModifierEffectType.PIERCE:
                // 预留：需要 BaseBullet 支持穿透计数
                console.log('[RoguelikeRewardSystem] 穿透效果暂未实现');
                break;
            case ModifierEffectType.PICKUP_RANGE_UP:
                // 预留
                break;
        }
    }

    // ────────────────────────────────
    //  属性重算（同类型修改器乘法叠加）
    // ────────────────────────────────

    private static _recalcFireRate(): void {
        let multiplier = 1.0;
        for (const active of RoguelikeRewardSystem._activeModifiers.values()) {
            if (active.def.effectType === ModifierEffectType.FIRE_RATE_UP) {
                multiplier *= Math.pow(active.def.value, active.stackCount);
            }
        }
        EventBus.emit('MODIFIER_FIRE_RATE_CHANGED', multiplier);
    }

    private static _recalcDamage(): void {
        let multiplier = 1.0;
        for (const active of RoguelikeRewardSystem._activeModifiers.values()) {
            if (active.def.effectType === ModifierEffectType.DAMAGE_UP) {
                multiplier *= Math.pow(active.def.value, active.stackCount);
            }
        }
        EventBus.emit('MODIFIER_DAMAGE_CHANGED', multiplier);
    }

    private static _recalcBulletSpeed(): void {
        let multiplier = 1.0;
        for (const active of RoguelikeRewardSystem._activeModifiers.values()) {
            if (active.def.effectType === ModifierEffectType.BULLET_SPEED_UP) {
                multiplier *= Math.pow(active.def.value, active.stackCount);
            }
        }
        EventBus.emit('MODIFIER_BULLET_SPEED_CHANGED', multiplier);
    }

    private static _getTotalMultishot(): number {
        let total = 0;
        for (const active of RoguelikeRewardSystem._activeModifiers.values()) {
            if (active.def.effectType === ModifierEffectType.MULTISHOT) {
                total += active.def.value * active.stackCount;
            }
        }
        return total;
    }

    // ────────────────────────────────
    //  公开查询接口
    // ────────────────────────────────

    public static get activeModifiers(): ReadonlyMap<string, ActiveModifier> {
        return RoguelikeRewardSystem._activeModifiers;
    }

    public static get isAwaitingChoice(): boolean {
        return RoguelikeRewardSystem._isAwaitingChoice;
    }

    public static get currentOptions(): ReadonlyArray<RewardOption> {
        return RoguelikeRewardSystem._currentOptions;
    }

    public static getModifierStack(id: string): number {
        return RoguelikeRewardSystem._activeModifiers.get(id)?.stackCount ?? 0;
    }

    /** 获取当前总属性倍率（供 UI 显示或调试） */
    public static getTotalStats(): { fireRateMul: number; damageMul: number; bulletSpeedMul: number; multishot: number } {
        let fireRateMul = 1.0;
        let damageMul = 1.0;
        let bulletSpeedMul = 1.0;
        let multishot = 0;

        for (const active of RoguelikeRewardSystem._activeModifiers.values()) {
            switch (active.def.effectType) {
                case ModifierEffectType.FIRE_RATE_UP:
                    fireRateMul *= Math.pow(active.def.value, active.stackCount);
                    break;
                case ModifierEffectType.DAMAGE_UP:
                    damageMul *= Math.pow(active.def.value, active.stackCount);
                    break;
                case ModifierEffectType.BULLET_SPEED_UP:
                    bulletSpeedMul *= Math.pow(active.def.value, active.stackCount);
                    break;
                case ModifierEffectType.MULTISHOT:
                    multishot += active.def.value * active.stackCount;
                    break;
            }
        }

        return { fireRateMul, damageMul, bulletSpeedMul, multishot };
    }

    /** 重置（游戏重新开始时调用） */
    public static reset(): void {
        RoguelikeRewardSystem._activeModifiers.clear();
        RoguelikeRewardSystem._isAwaitingChoice = false;
        RoguelikeRewardSystem._currentOptions = [];
        RoguelikeRewardSystem._totalDraws = 0;
        BulletFactory.clearGlobalModifiers();
    }
}
