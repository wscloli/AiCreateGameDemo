/**
 * HPBar.ts
 *
 * 通用头顶生命条组件。
 * - 背景条与填充条为平级子节点
 * - 使用 UITransform.contentSize 控制填充长度
 * - 挂到玩家/敌人节点下作为子节点，自动跟随父节点
 */

import { _decorator, Component, Node, Sprite, Color, UITransform } from 'cc';
import { EntityVisualFactory } from '../Core/EntityVisualFactory';

const { ccclass } = _decorator;

const COLOR_BG = new Color(30, 30, 30, 220);      // 暗色底条
const COLOR_GREEN = new Color(50, 220, 80, 255);   // 玩家绿
const COLOR_RED = new Color(220, 50, 50, 255);     // 敌人红

@ccclass('HPBar')
export class HPBar extends Component {
    private _barBg: Sprite | null = null;
    private _barFill: Sprite | null = null;
    private _fillTransform: UITransform | null = null;

    /** 生命条总宽度（像素） */
    private _barWidth: number = 48;
    /** 生命条高度（像素） */
    private _barHeight: number = 6;
    /** 当前进度 0~1 */
    private _progress: number = 1;

    /**
     * 初始化生命条
     * @param isPlayer true=绿色, false=红色
     * @param barWidth  总宽度（默认 48）
     * @param yOffset   在父节点上方的偏移（默认 40）
     */
    public init(isPlayer: boolean, barWidth: number = 48, yOffset: number = 40): void {
        this._barWidth = barWidth;
        this._barHeight = 6;
        this._progress = 1;

        // 背景条（暗色）
        const bgNode = new Node('HPBarBg');
        this.node.addChild(bgNode);
        bgNode.setPosition(0, 0, 0);

        const bgUt = bgNode.addComponent(UITransform);
        bgUt.setContentSize(this._barWidth, this._barHeight);

        this._barBg = bgNode.addComponent(Sprite);
        // ⚠️ 必须先设 CUSTOM，再设 spriteFrame，否则 contentSize 会被自动覆盖为纹理尺寸
        this._barBg.sizeMode = Sprite.SizeMode.CUSTOM;
        this._barBg.spriteFrame = EntityVisualFactory.getWhiteSpriteFrame();
        this._barBg.color = COLOR_BG;

        // 填充条（彩色）— 平级子节点，左对齐
        const fillNode = new Node('HPBarFill');
        this.node.addChild(fillNode);
        fillNode.setPosition(-this._barWidth / 2, 0, 0);

        this._fillTransform = fillNode.addComponent(UITransform);
        this._fillTransform.setContentSize(this._barWidth, this._barHeight);
        this._fillTransform.anchorX = 0;
        this._fillTransform.anchorY = 0.5;

        this._barFill = fillNode.addComponent(Sprite);
        // ⚠️ 必须先设 CUSTOM，再设 spriteFrame
        this._barFill.sizeMode = Sprite.SizeMode.CUSTOM;
        this._barFill.spriteFrame = EntityVisualFactory.getWhiteSpriteFrame();
        this._barFill.color = isPlayer ? COLOR_GREEN : COLOR_RED;

        // 整个 HPBar 节点相对于父节点的位置
        this.node.setPosition(0, yOffset, 0);

        this.setProgress(1);
    }

    /** 设置进度 0~1 */
    public setProgress(ratio: number): void {
        const clamped = Math.max(0, Math.min(1, ratio));
        if (this._progress === clamped) return;
        this._progress = clamped;

        if (this._fillTransform) {
            this._fillTransform.setContentSize(this._barWidth * clamped, this._barHeight);
        }
    }

    /** 是否可见 */
    public setVisible(visible: boolean): void {
        this.node.active = visible;
    }

    /** 清理时重置 */
    public reset(): void {
        this.setProgress(1);
        this.setVisible(true);
    }
}
