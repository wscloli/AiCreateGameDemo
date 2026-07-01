/**
 * ElementReactionHub.ts
 * 
 * 全局单例 - 元素反应矩阵管理中心
 * 负责：元素枚举定义、反应查表、反应事件派发
 * 
 * 设计原则：
 * - 纯数据驱动，零渲染依赖
 * - 反应查表 O(1)，无递归
 * - 通过 EventBus 回调解耦，预留特效/物理接口
 */

/** 元素类型枚举 */
export enum ElementType {
    NONE = 'NONE',
    FIRE = 'FIRE',
    OIL = 'OIL',
    WATER = 'WATER',
    LIGHTNING = 'LIGHTNING',
    GLUE = 'GLUE',
}

/** 反应结果数据结构 */
export interface ReactionResult {
    reactionName: string;
    damageMultiplier: number;
    consumedElements: ElementType[];   // 反应中消耗掉的元素
}

/** 反应事件回调签名 */
export type ReactionCallback = (
    targetId: string,
    reaction: ReactionResult,
    position: { x: number; y: number }
) => void;

/**
 * 反应矩阵条目
 */
interface ReactionEntry {
    reactionName: string;
    damageMultiplier: number;
}

/**
 * ElementReactionHub
 * 
 * 静态类，全局唯一入口。
 * 内部维护一张二维查表矩阵（Map 嵌套），实现 O(1) 反应判定。
 * 支持外部注册 reactionCallback，用于解耦地触发特效/伤害/物理表现。
 */
export class ElementReactionHub {
    /** 反应矩阵：Map<元素A, Map<元素B, ReactionEntry>> */
    private static _reactionTable: Map<ElementType, Map<ElementType, ReactionEntry>> = new Map();

    /** 外部注册的反应回调列表 */
    private static _callbacks: ReactionCallback[] = [];

    /** 是否已初始化 */
    private static _initialized = false;

    // ────────────────────────────────
    //  初始化
    // ────────────────────────────────

    /**
     * 初始化反应矩阵。
     * 必须在游戏启动时调用一次。
     * 矩阵对称：A+B 与 B+A 指向同一反应。
     */
    public static init(): void {
        if (this._initialized) return;

        this._defineReaction(ElementType.FIRE, ElementType.OIL, 'FIRE_EXPLOSION', 2.0);
        this._defineReaction(ElementType.LIGHTNING, ElementType.WATER, 'LIGHTNING_CONDUCT', 1.5);
        this._defineReaction(ElementType.LIGHTNING, ElementType.OIL, 'MAGNETIC_PULL', 1.0);

        // GLUE + 任何元素（除自身）→ MONSTER_MERGE
        const allElements = [
            ElementType.FIRE, ElementType.OIL,
            ElementType.WATER, ElementType.LIGHTNING,
        ];
        for (const el of allElements) {
            this._defineReaction(ElementType.GLUE, el, 'MONSTER_MERGE', 0.5);
        }

        this._initialized = true;
    }

    /**
     * 定义一条反应规则（双向注册）
     */
    private static _defineReaction(
        a: ElementType,
        b: ElementType,
        reactionName: string,
        damageMultiplier: number,
    ): void {
        const entry: ReactionEntry = { reactionName, damageMultiplier };

        if (!this._reactionTable.has(a)) {
            this._reactionTable.set(a, new Map());
        }
        this._reactionTable.get(a)!.set(b, entry);

        // 对称注册（B+A 指向同一反应）
        if (!this._reactionTable.has(b)) {
            this._reactionTable.set(b, new Map());
        }
        this._reactionTable.get(b)!.set(a, entry);
    }

    // ────────────────────────────────
    //  核心查表
    // ────────────────────────────────

    /**
     * 检测新命中元素与敌人已有元素之间是否发生反应。
     * 
     * @param enemyStatusComponent  敌人的状态组件（需暴露 `id: string`、`activeElements: Set<ElementType>`）
     * @param newElement            本次命中的新元素
     * @returns ReactionResult | null  — 发生反应返回结果，否则返回 null
     */
    public static checkReaction(
        enemyStatusComponent: { id: string; activeElements: Set<ElementType>; position: { x: number; y: number } },
        newElement: ElementType,
    ): ReactionResult | null {
        if (!this._initialized) {
            console.warn('[ElementReactionHub] 未调用 init()，请先初始化');
            return null;
        }

        if (newElement === ElementType.NONE) return null;

        const activeElements = enemyStatusComponent.activeElements;

        // 遍历敌人已有的元素，查表
        for (const existingElement of activeElements) {
            const row = this._reactionTable.get(existingElement);
            if (!row) continue;

            const entry = row.get(newElement);
            if (entry) {
                // 构造反应结果
                const result: ReactionResult = {
                    reactionName: entry.reactionName,
                    damageMultiplier: entry.damageMultiplier,
                    consumedElements: [existingElement, newElement],
                };

                // 从敌人状态中移除被消耗的元素
                activeElements.delete(existingElement);

                // 派发事件
                this._dispatchReaction(enemyStatusComponent.id, result, enemyStatusComponent.position);

                return result;
            }
        }

        // 无反应：新元素挂载到敌人状态上
        activeElements.add(newElement);

        return null;
    }

    // ────────────────────────────────
    //  事件派发
    // ────────────────────────────────

    /**
     * 注册反应回调（支持多个监听者）
     */
    public static onReaction(callback: ReactionCallback): void {
        this._callbacks.push(callback);
    }

    /**
     * 移除指定回调
     */
    public static offReaction(callback: ReactionCallback): void {
        const idx = this._callbacks.indexOf(callback);
        if (idx !== -1) {
            this._callbacks.splice(idx, 1);
        }
    }

    /**
     * 清空所有回调
     */
    public static clearCallbacks(): void {
        this._callbacks.length = 0;
    }

    /**
     * 内部派发反应事件
     */
    private static _dispatchReaction(
        targetId: string,
        reaction: ReactionResult,
        position: { x: number; y: number },
    ): void {
        for (const cb of this._callbacks) {
            try {
                cb(targetId, reaction, position);
            } catch (err) {
                console.error('[ElementReactionHub] 回调执行出错:', err);
            }
        }
    }

    // ────────────────────────────────
    //  工具方法
    // ────────────────────────────────

    /** 获取当前已注册的所有反应名称列表 */
    public static getRegisteredReactions(): string[] {
        const names = new Set<string>();
        for (const row of this._reactionTable.values()) {
            for (const entry of row.values()) {
                names.add(entry.reactionName);
            }
        }
        return Array.from(names);
    }

    /** 重置（主要用于测试） */
    public static reset(): void {
        this._reactionTable.clear();
        this._callbacks.length = 0;
        this._initialized = false;
    }
}
