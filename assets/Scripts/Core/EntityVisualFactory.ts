/**
 * EntityVisualFactory.ts
 *
 * 运行时视觉模板工厂 —— 不依赖 .prefab 资源，纯代码构建带 Sprite 的节点。
 *
 * 职责：
 * - 为子弹、敌人、玩家生成带纯色 Sprite 的节点模板
 * - 颜色可配置，支持不同元素/类型的视觉区分
 * - 生成的模板节点可传入 PoolManager.registerPool 作为 templateNode
 */

import { Node, Sprite, SpriteFrame, Texture2D, UITransform, Color } from 'cc';

export interface VisualConfig {
    /** 节点名称 */
    name: string;
    /** 节点尺寸 */
    size: { width: number; height: number };
    /** 填充颜色 (RGBA 0-255) */
    color: { r: number; g: number; b: number; a: number };
    /** 可选：带 1px 描边的颜色 */
    outline?: { r: number; g: number; b: number; a: number };
}

export class EntityVisualFactory {
    private static _spriteFrameCache: Map<string, SpriteFrame> = new Map();

    /**
     * 根据配置创建一个带 Sprite 的节点模板
     */
    public static createTemplateNode(config: VisualConfig): Node {
        const node = new Node(config.name);

        // UITransform 定义尺寸
        const ut = node.addComponent(UITransform);
        ut.setContentSize(config.size.width, config.size.height);

        // Sprite
        const sp = node.addComponent(Sprite);
        sp.spriteFrame = this._getOrCreateSpriteFrame(config.color, config.outline);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.trim = false;

        return node;
    }

    /**
     * 快速创建纯色 SpriteFrame（内部缓存）
     */
    private static _getOrCreateSpriteFrame(
        color: { r: number; g: number; b: number; a: number },
        outline?: { r: number; g: number; b: number; a: number },
    ): SpriteFrame {
        const key = `${color.r},${color.g},${color.b},${color.a}|${outline ? outline.r + ',' + outline.g + ',' + outline.b + ',' + outline.a : 'none'}`;
        if (this._spriteFrameCache.has(key)) {
            return this._spriteFrameCache.get(key)!;
        }

        const size = 64;
        const texture = new Texture2D();
        texture.reset({
            width: size,
            height: size,
            format: Texture2D.PixelFormat.RGBA8888,
        });

        const data = new Uint8Array(size * size * 4);

        if (outline) {
            // 1px 描边
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const isEdge = x === 0 || x === size - 1 || y === 0 || y === size - 1;
                    const c = isEdge ? outline : color;
                    data[i] = c.r;
                    data[i + 1] = c.g;
                    data[i + 2] = c.b;
                    data[i + 3] = c.a;
                }
            }
        } else {
            // 纯色填充
            for (let i = 0; i < data.length; i += 4) {
                data[i] = color.r;
                data[i + 1] = color.g;
                data[i + 2] = color.b;
                data[i + 3] = color.a;
            }
        }

        texture.uploadData(data);

        const sf = new SpriteFrame();
        sf.texture = texture;
        sf.rect.width = size;
        sf.rect.height = size;
        sf.originalSize.width = size;
        sf.originalSize.height = size;
        sf.offset.x = 0;
        sf.offset.y = 0;

        this._spriteFrameCache.set(key, sf);
        return sf;
    }

    /** 清空缓存（场景切换时调用） */
    public static clearCache(): void {
        this._spriteFrameCache.clear();
    }
}
