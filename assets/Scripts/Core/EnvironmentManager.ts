/**
 * EnvironmentManager.ts
 *
 * 战场环境区域管理器 —— 油洼、积水区等持久性地形效果。
 *
 * 职责：
 * - 管理所有活跃的环境区域（生成、更新、回收）
 * - 提供查询接口：某位置处于哪些区域内
 * - 由 GameLoop.tick 按优先级驱动（P5 元素衰减之后）
 * - 纯数学距离检测，不依赖 Physics2D
 */

import { _decorator, Component, Node, Graphics, Color, Vec3 } from 'cc';
import { ElementType } from './ElementReactionHub';

const { ccclass } = _decorator;

export enum ZoneType {
    OIL_PUDDLE = 'OIL_PUDDLE',
    WATER_POOL = 'WATER_POOL',
}

export interface EnvironmentZone {
    id: string;
    type: ZoneType;
    element: ElementType;
    x: number;
    y: number;
    radius: number;
    maxDuration: number;
    remaining: number;
    /** 视觉节点 */
    visualNode: Node;
}

/** 处于环境区域中的实体效果 */
export interface ZoneEffect {
    /** 移速倍率（1.0 = 正常） */
    moveSpeedMultiplier: number;
    /** 受到的伤害倍率（1.0 = 正常） */
    damageTakenMultiplier: number;
    /** 额外元素状态（进入区域时自动附加） */
    autoApplyElement: ElementType | null;
}

@ccclass('EnvironmentManager')
export class EnvironmentManager extends Component {
    private static _instance: EnvironmentManager | null = null;
    private static _zones: Map<string, EnvironmentZone> = new Map();
    private static _zoneIdCounter: number = 0;

    protected onLoad(): void {
        EnvironmentManager._instance = this;
    }

    protected onDestroy(): void {
        EnvironmentManager._instance = null;
        EnvironmentManager.clearAll();
    }

    // ────────────────────────────────
    //  GameLoop 驱动接口
    // ────────────────────────────────

    public static tick(dt: number): void {
        const expired: string[] = [];
        for (const [id, zone] of EnvironmentManager._zones) {
            zone.remaining -= dt;
            if (zone.remaining <= 0) {
                expired.push(id);
            } else {
                // 更新视觉透明度（随时间淡出）
                EnvironmentManager._updateVisual(zone);
            }
        }
        for (const id of expired) {
            EnvironmentManager._removeZone(id);
        }
    }

    // ────────────────────────────────
    //  区域生成
    // ────────────────────────────────

    public static spawnZone(
        type: ZoneType,
        position: { x: number; y: number },
        radius: number = 80,
        duration: number = 10.0,
    ): EnvironmentZone | null {
        const canvas = EnvironmentManager._instance?.node.scene?.getChildByName('Canvas');
        if (!canvas) return null;

        const id = `zone_${++EnvironmentManager._zoneIdCounter}`;

        const element = type === ZoneType.OIL_PUDDLE ? ElementType.OIL : ElementType.WATER;

        // 创建视觉节点
        const visualNode = new Node(id);
        canvas.addChild(visualNode);
        visualNode.setPosition(new Vec3(position.x, position.y, 0));

        const g = visualNode.addComponent(Graphics);
        const color = type === ZoneType.OIL_PUDDLE
            ? new Color(160, 120, 60, 120)
            : new Color(40, 100, 200, 100);
        g.fillColor = color;
        g.circle(0, 0, radius);
        g.fill();
        // 外圈描边
        g.strokeColor = new Color(color.r, color.g, color.b, 180);
        g.lineWidth = 2;
        g.circle(0, 0, radius);
        g.stroke();

        const zone: EnvironmentZone = {
            id,
            type,
            element,
            x: position.x,
            y: position.y,
            radius,
            maxDuration: duration,
            remaining: duration,
            visualNode,
        };

        EnvironmentManager._zones.set(id, zone);
        return zone;
    }

    // ────────────────────────────────
    //  查询接口
    // ────────────────────────────────

    /**
     * 查询某位置处的环境效果（叠加所有区域的影响）
     */
    public static queryEffectAt(x: number, y: number): ZoneEffect {
        let moveSpeedMultiplier = 1.0;
        let damageTakenMultiplier = 1.0;
        let autoApplyElement: ElementType | null = null;

        for (const zone of EnvironmentManager._zones.values()) {
            const dx = x - zone.x;
            const dy = y - zone.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > zone.radius) continue;

            // 区域效果叠加
            switch (zone.type) {
                case ZoneType.OIL_PUDDLE:
                    moveSpeedMultiplier *= 0.7; // 油洼减速 30%
                    autoApplyElement = ElementType.OIL;
                    break;
                case ZoneType.WATER_POOL:
                    damageTakenMultiplier *= 1.2; // 积水区受到伤害 +20%
                    autoApplyElement = ElementType.WATER;
                    break;
            }
        }

        return { moveSpeedMultiplier, damageTakenMultiplier, autoApplyElement };
    }

    /**
     * 获取某位置附近的所有区域
     */
    public static getZonesAt(x: number, y: number): EnvironmentZone[] {
        const result: EnvironmentZone[] = [];
        for (const zone of EnvironmentManager._zones.values()) {
            const dx = x - zone.x;
            const dy = y - zone.y;
            if (dx * dx + dy * dy <= zone.radius * zone.radius) {
                result.push(zone);
            }
        }
        return result;
    }

    /**
     * 获取某位置附近指定类型的区域
     */
    public static hasZoneTypeAt(x: number, y: number, type: ZoneType): boolean {
        for (const zone of EnvironmentManager._zones.values()) {
            if (zone.type !== type) continue;
            const dx = x - zone.x;
            const dy = y - zone.y;
            if (dx * dx + dy * dy <= zone.radius * zone.radius) {
                return true;
            }
        }
        return false;
    }

    // ────────────────────────────────
    //  内部方法
    // ────────────────────────────────

    private static _updateVisual(zone: EnvironmentZone): void {
        const progress = zone.remaining / zone.maxDuration;
        const g = zone.visualNode.getComponent(Graphics);
        if (!g) return;

        g.clear();
        const baseColor = zone.type === ZoneType.OIL_PUDDLE
            ? new Color(160, 120, 60, Math.floor(120 * progress))
            : new Color(40, 100, 200, Math.floor(100 * progress));
        g.fillColor = baseColor;
        g.circle(0, 0, zone.radius);
        g.fill();
        g.strokeColor = new Color(baseColor.r, baseColor.g, baseColor.b, Math.floor(180 * progress));
        g.lineWidth = 2;
        g.circle(0, 0, zone.radius);
        g.stroke();
    }

    private static _removeZone(id: string): void {
        const zone = EnvironmentManager._zones.get(id);
        if (!zone) return;

        if (zone.visualNode.isValid) {
            zone.visualNode.removeFromParent();
        }
        EnvironmentManager._zones.delete(id);
    }

    public static clearAll(): void {
        for (const zone of EnvironmentManager._zones.values()) {
            if (zone.visualNode.isValid) {
                zone.visualNode.removeFromParent();
            }
        }
        EnvironmentManager._zones.clear();
    }

    public static get activeZoneCount(): number {
        return EnvironmentManager._zones.size;
    }
}
