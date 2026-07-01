/**
 * EventBus.ts
 *
 * 全局轻量级事件总线（单例）
 *
 * 设计原则：
 * - 零依赖，纯 Map 实现，O(1) 查找
 * - 支持 target 绑定，off 时可精确移除
 * - 异常隔离：单个回调抛错不影响其他监听者
 */

type EventHandler = { callback: Function; target?: any };

export class EventBus {
    private static _events: Map<string, Set<EventHandler>> = new Map();

    /**
     * 注册事件监听
     * @param eventName  事件名称
     * @param callback   回调函数
     * @param target     可选绑定目标（用于 off 精确移除）
     */
    public static on(eventName: string, callback: Function, target?: any): void {
        if (!EventBus._events.has(eventName)) {
            EventBus._events.set(eventName, new Set());
        }
        EventBus._events.get(eventName)!.add({ callback, target });
    }

    /**
     * 移除事件监听
     * - 只传 eventName：移除该事件所有监听
     * - 传 eventName + callback：移除特定回调
     * - 传 eventName + target：移除该 target 下的所有回调
     * - 传 eventName + callback + target：精确移除
     */
    public static off(eventName: string, callback?: Function, target?: any): void {
        const handlers = EventBus._events.get(eventName);
        if (!handlers) return;

        if (!callback && !target) {
            // 移除该事件所有监听
            EventBus._events.delete(eventName);
            return;
        }

        for (const handler of handlers) {
            const matchCallback = !callback || handler.callback === callback;
            const matchTarget = !target || handler.target === target;
            if (matchCallback && matchTarget) {
                handlers.delete(handler);
            }
        }

        if (handlers.size === 0) {
            EventBus._events.delete(eventName);
        }
    }

    /**
     * 派发事件
     * @param eventName  事件名称
     * @param args       可变参数，透传给回调
     */
    public static emit(eventName: string, ...args: any[]): void {
        const handlers = EventBus._events.get(eventName);
        if (!handlers || handlers.size === 0) return;

        // 快照拷贝，防止遍历过程中 handlers 被修改
        const snapshot = Array.from(handlers);
        for (const handler of snapshot) {
            try {
                if (handler.target) {
                    handler.callback.call(handler.target, ...args);
                } else {
                    handler.callback(...args);
                }
            } catch (err) {
                console.error(`[EventBus] 事件 "${eventName}" 回调执行出错:`, err);
            }
        }
    }

    /**
     * 检查某事件是否有监听者
     */
    public static has(eventName: string): boolean {
        const handlers = EventBus._events.get(eventName);
        return handlers !== undefined && handlers.size > 0;
    }

    /**
     * 清空所有事件监听
     */
    public static clear(): void {
        EventBus._events.clear();
    }

    /**
     * 获取当前注册的事件名称列表
     */
    public static getEventNames(): string[] {
        return Array.from(EventBus._events.keys());
    }
}
