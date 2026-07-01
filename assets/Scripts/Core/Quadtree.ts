/**
 * Quadtree.ts
 *
 * 轻量级空间四叉树（性能命脉）
 *
 * 用于高效管理同屏大量子弹和敌人的空间查询，
 * 替代 Cocos Physics2D 碰撞体。
 *
 * 设计原则：
 * - 纯数学计算，零渲染/物理依赖
 * - 支持动态插入/移除（每帧更新）
 * - 查询返回候选列表，由调用方做精确 Vec2.distance 判定
 */

/** 四叉树节点边界 */
export interface QuadBounds {
    x: number;
    y: number;
    halfWidth: number;
    halfHeight: number;
}

/** 可插入四叉树的对象接口 */
export interface IQuadEntity {
    /** 对象唯一标识 */
    id: string;
    /** 当前位置 */
    x: number;
    y: number;
    /** 碰撞半径（像素） */
    radius: number;
}

/** 四叉树节点 */
class QuadTreeNode {
    public bounds: QuadBounds;
    public entities: IQuadEntity[] = [];
    public children: QuadTreeNode[] | null = null;

    private readonly _maxEntities: number;
    private readonly _maxDepth: number;
    private readonly _depth: number;

    constructor(bounds: QuadBounds, maxEntities: number, maxDepth: number, depth: number = 0) {
        this.bounds = bounds;
        this._maxEntities = maxEntities;
        this._maxDepth = maxDepth;
        this._depth = depth;
    }

    /**
     * 插入一个实体
     */
    public insert(entity: IQuadEntity): void {
        // 如果不是叶子节点，交给子节点
        if (this.children !== null) {
            this._insertToChildren(entity);
            return;
        }

        // 叶子节点：直接添加
        this.entities.push(entity);

        // 超出容量且未达最大深度 → 分裂
        if (this.entities.length > this._maxEntities && this._depth < this._maxDepth) {
            this._split();
        }
    }

    /**
     * 移除一个实体
     */
    public remove(entityId: string): boolean {
        if (this.children !== null) {
            for (const child of this.children) {
                if (child.remove(entityId)) return true;
            }
            return false;
        }

        const idx = this.entities.findIndex(e => e.id === entityId);
        if (idx !== -1) {
            this.entities.splice(idx, 1);
            return true;
        }
        return false;
    }

    /**
     * 查询指定范围内的所有实体
     */
    public query(range: QuadBounds, result: IQuadEntity[]): void {
        // 检查范围是否与当前节点相交
        if (!this._intersects(range)) return;

        if (this.children !== null) {
            // 非叶子节点：递归查询子节点
            for (const child of this.children) {
                child.query(range, result);
            }
        } else {
            // 叶子节点：收集所有实体
            for (const entity of this.entities) {
                result.push(entity);
            }
        }
    }

    /**
     * 清空所有实体
     */
    public clear(): void {
        this.entities.length = 0;
        if (this.children !== null) {
            for (const child of this.children) {
                child.clear();
            }
            this.children = null;
        }
    }

    /**
     * 分裂为四个子节点
     */
    private _split(): void {
        const { x, y, halfWidth, halfHeight } = this.bounds;
        const childW = halfWidth / 2;
        const childH = halfHeight / 2;

        this.children = [
            // 西北
            new QuadTreeNode(
                { x: x - childW, y: y + childH, halfWidth: childW, halfHeight: childH },
                this._maxEntities, this._maxDepth, this._depth + 1,
            ),
            // 东北
            new QuadTreeNode(
                { x: x + childW, y: y + childH, halfWidth: childW, halfHeight: childH },
                this._maxEntities, this._maxDepth, this._depth + 1,
            ),
            // 西南
            new QuadTreeNode(
                { x: x - childW, y: y - childH, halfWidth: childW, halfHeight: childH },
                this._maxEntities, this._maxDepth, this._depth + 1,
            ),
            // 东南
            new QuadTreeNode(
                { x: x + childW, y: y - childH, halfWidth: childW, halfHeight: childH },
                this._maxEntities, this._maxDepth, this._depth + 1,
            ),
        ];

        // 将当前实体验证到子节点
        const entities = this.entities;
        this.entities = [];
        for (const entity of entities) {
            this._insertToChildren(entity);
        }
    }

    private _insertToChildren(entity: IQuadEntity): void {
        for (const child of this.children!) {
            if (this._contains(child.bounds, entity)) {
                child.insert(entity);
                return;
            }
        }
        // 如果实体不在任何子节点边界内（边界上的实体），留在父节点
        this.entities.push(entity);
    }

    private _contains(bounds: QuadBounds, entity: IQuadEntity): boolean {
        return (
            entity.x >= bounds.x - bounds.halfWidth &&
            entity.x <= bounds.x + bounds.halfWidth &&
            entity.y >= bounds.y - bounds.halfHeight &&
            entity.y <= bounds.y + bounds.halfHeight
        );
    }

    private _intersects(range: QuadBounds): boolean {
        const { x: rx, y: ry, halfWidth: rw, halfHeight: rh } = range;
        const { x: bx, y: by, halfWidth: bw, halfHeight: bh } = this.bounds;

        return (
            rx - rw < bx + bw &&
            rx + rw > bx - bw &&
            ry - rh < by + bh &&
            ry + rh > by - bh
        );
    }
}

/**
 * Quadtree
 *
 * 对外暴露的简易四叉树接口。
 * 每帧调用 clear() 后重新 insert 所有实体，避免移动对象的位置过期。
 */
export class Quadtree {
    private _root: QuadTreeNode;

    constructor(
        worldWidth: number,
        worldHeight: number,
        maxEntitiesPerNode: number = 8,
        maxDepth: number = 8,
    ) {
        this._root = new QuadTreeNode(
            { x: 0, y: 0, halfWidth: worldWidth / 2, halfHeight: worldHeight / 2 },
            maxEntitiesPerNode,
            maxDepth,
        );
    }

    /**
     * 插入一个实体
     */
    public insert(entity: IQuadEntity): void {
        this._root.insert(entity);
    }

    /**
     * 移除一个实体
     */
    public remove(entityId: string): void {
        this._root.remove(entityId);
    }

    /**
     * 查询指定位置附近的所有实体
     *
     * @param x      查询中心 x
     * @param y      查询中心 y
     * @param radius 查询半径
     * @returns 候选实体列表
     */
    public query(x: number, y: number, radius: number): IQuadEntity[] {
        const result: IQuadEntity[] = [];
        this._root.query(
            { x, y, halfWidth: radius, halfHeight: radius },
            result,
        );
        return result;
    }

    /**
     * 清空所有实体（每帧调用）
     */
    public clear(): void {
        this._root.clear();
    }
}
