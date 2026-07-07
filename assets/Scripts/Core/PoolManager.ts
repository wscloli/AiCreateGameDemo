/**
 * PoolManager.ts
 *
 * 全局对象池管理器（性能命脉）
 *
 * 设计原则：
 * - 所有实体（子弹、敌人、特效）必须走 spawn/despawn，严禁 destroy/instantiate
 * - 支持预生成（prewarm），避免运行时卡顿
 * - 池内对象以 cc.Node 为载体，通过 setActive 切换可见性
 * - 自动追踪活跃对象，支持批量回收
 */

import { _decorator, Component, Node, instantiate, Prefab } from 'cc';

/** 对象池注册选项 */
export interface PoolRegisterOptions<T extends Component> {
    componentClass: new () => T;
    prewarmCount?: number;
    /** 可选：预制体资源（优先于 templateNode） */
    prefab?: Prefab | null;
    /** 可选：运行时模板节点 */
    templateNode?: Node | null;
}

const { ccclass } = _decorator;

/** 对象池单池 */
class ObjectPool<T extends Component> {
    private _pool: T[] = [];
    private _active: Set<T> = new Set();
    private _prefab: Prefab | null = null;
    private _templateNode: Node | null = null;
    private _componentClass: new () => T;
    private _nodeParent: Node;

    constructor(
        componentClass: new () => T,
        nodeParent: Node,
        prefab: Prefab | null = null,
        templateNode: Node | null = null,
    ) {
        this._componentClass = componentClass;
        this._nodeParent = nodeParent;
        this._prefab = prefab;
        this._templateNode = templateNode;
    }

    /**
     * 预生成指定数量的实例
     */
    public prewarm(count: number): void {
        for (let i = 0; i < count; i++) {
            const instance = this._createInstance();
            instance.node.active = false;
            this._pool.push(instance);
        }
    }

    /**
     * 从池中取出一个实例
     */
    public spawn(): T {
        let instance: T;

        if (this._pool.length > 0) {
            instance = this._pool.pop()!;
        } else {
            instance = this._createInstance();
        }

        instance.node.active = true;
        this._active.add(instance);
        return instance;
    }

    /**
     * 将实例回收到池中
     */
    public despawn(instance: T): void {
        if (!this._active.has(instance)) return;

        this._active.delete(instance);
        instance.node.active = false;
        this._pool.push(instance);
    }

    /**
     * 回收所有活跃实例
     */
    public despawnAll(): void {
        const snapshot = Array.from(this._active);
        for (const instance of snapshot) {
            this.despawn(instance);
        }
    }

    /**
     * 获取当前活跃对象数量
     */
    public get activeCount(): number {
        return this._active.size;
    }

    /**
     * 获取池中可用对象数量
     */
    public get idleCount(): number {
        return this._pool.length;
    }

    /**
     * 获取所有活跃实例（只读快照）
     */
    public getActiveList(): T[] {
        return Array.from(this._active);
    }

    /**
     * 运行时设置模板节点（池已注册后也可调用）
     */
    public setTemplateNode(node: Node): void {
        this._templateNode = node;
    }

    /**
     * 创建新实例
     */
    private _createInstance(): T {
        let node: Node;

        if (this._prefab) {
            node = instantiate(this._prefab);
        } else if (this._templateNode) {
            node = instantiate(this._templateNode);
        } else {
            node = new Node();
        }

        node.parent = this._nodeParent;

        let component = node.getComponent(this._componentClass);
        if (!component) {
            component = node.addComponent(this._componentClass);
        }

        return component;
    }
}

/**
 * PoolManager
 *
 * 全局单例，管理所有类型的对象池。
 * 按类名索引，每种组件类型对应一个独立池。
 */
@ccclass('PoolManager')
export class PoolManager extends Component {
    private static _instance: PoolManager | null = null;
    private static _pools: Map<string, ObjectPool<any>> = new Map();

    protected onLoad(): void {
        PoolManager._instance = this;
    }

    protected onDestroy(): void {
        PoolManager._instance = null;
        PoolManager._pools.clear();
    }

    /**
     * 获取 PoolManager 实例
     */
    public static get instance(): PoolManager {
        return PoolManager._instance!;
    }

    /**
     * 注册一个对象池（兼容旧签名：componentClass, prewarmCount, prefab?）
     */
    public static registerPool<T extends Component>(
        componentClass: new () => T,
        prewarmCount?: number,
        prefab?: Prefab | null,
    ): void;

    /**
     * 注册一个对象池（新签名：通过 options 传入模板节点）
     */
    public static registerPool<T extends Component>(
        options: PoolRegisterOptions<T>,
    ): void;

    public static registerPool(
        arg1: any,
        arg2?: number,
        arg3?: Prefab | null,
    ): void {
        let componentClass: new () => Component;
        let prewarmCount = 0;
        let prefab: Prefab | null = null;
        let templateNode: Node | null = null;

        if (typeof arg1 === 'function') {
            // 旧签名
            componentClass = arg1;
            prewarmCount = arg2 ?? 0;
            prefab = arg3 ?? null;
        } else {
            // 新签名
            componentClass = arg1.componentClass;
            prewarmCount = arg1.prewarmCount ?? 0;
            prefab = arg1.prefab ?? null;
            templateNode = arg1.templateNode ?? null;
        }

        const className = componentClass.name;

        if (PoolManager._pools.has(className)) {
            console.warn(`[PoolManager] 池 "${className}" 已存在，跳过注册`);
            return;
        }

        if (!PoolManager._instance) {
            console.error('[PoolManager] 实例不存在，请将 PoolManager 挂载到场景');
            return;
        }

        const pool = new ObjectPool(
            componentClass,
            PoolManager._instance.node,
            prefab,
            templateNode,
        );
        PoolManager._pools.set(className, pool);

        if (prewarmCount > 0) {
            pool.prewarm(prewarmCount);
        }

        console.log(`[PoolManager] 注册池 "${className}"，预生成 ${prewarmCount} 个`);
    }

    /**
     * 从池中获取一个实例
     */
    public static spawn<T extends Component>(componentClass: new () => T): T {
        const className = componentClass.name;
        const pool = PoolManager._pools.get(className);

        if (!pool) {
            throw new Error(`[PoolManager] 未注册的池: "${className}"，请先调用 registerPool`);
        }

        return pool.spawn() as T;
    }

    /**
     * 回收实例到池中
     */
    public static despawn<T extends Component>(instance: T): void {
        const className = instance.constructor.name;
        const pool = PoolManager._pools.get(className);

        if (!pool) {
            console.warn(`[PoolManager] 未注册的池: "${className}"，实例将被销毁`);
            instance.node.destroy();
            return;
        }

        pool.despawn(instance);
    }

    /**
     * 回收指定类型的所有活跃实例
     */
    public static despawnAll<T extends Component>(componentClass: new () => T): void {
        const className = componentClass.name;
        const pool = PoolManager._pools.get(className);

        if (pool) {
            pool.despawnAll();
        }
    }

    /**
     * 获取指定类型的活跃对象数量
     */
    public static getActiveCount<T extends Component>(componentClass: new () => T): number {
        const className = componentClass.name;
        const pool = PoolManager._pools.get(className);
        return pool ? pool.activeCount : 0;
    }

    /**
     * 获取指定类型的活跃实例列表
     */
    public static getActiveList<T extends Component>(componentClass: new () => T): T[] {
        const className = componentClass.name;
        const pool = PoolManager._pools.get(className);
        return pool ? pool.getActiveList() : [];
    }

    /**
     * 为已注册的池预生成指定数量的实例
     */
    public static prewarm<T extends Component>(componentClass: new () => T, count: number): void {
        const className = componentClass.name;
        const pool = PoolManager._pools.get(className);
        if (!pool) {
            console.warn(`[PoolManager] 池 "${className}" 不存在，无法预生成`);
            return;
        }
        pool.prewarm(count);
    }

    /**
     * 为已注册的池设置运行时模板节点
     */
    public static setTemplateNode<T extends Component>(
        componentClass: new () => T,
        node: Node,
    ): void {
        const className = componentClass.name;
        const pool = PoolManager._pools.get(className);
        if (!pool) {
            console.warn(`[PoolManager] 池 "${className}" 不存在，无法设置模板节点`);
            return;
        }
        pool.setTemplateNode(node);
    }

    /**
     * 清空所有池
     */
    public static clearAll(): void {
        for (const [, pool] of PoolManager._pools) {
            pool.despawnAll();
        }
        PoolManager._pools.clear();
    }
}
