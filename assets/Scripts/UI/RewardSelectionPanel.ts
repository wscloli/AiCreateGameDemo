/**
 * RewardSelectionPanel.ts
 *
 * 波次结束后的奖励选择面板 —— 显示 3 个可选修改器卡片
 *
 * 监听：REWARD_SHOW
 * 派发：RoguelikeRewardSystem.selectOption(index)
 */

import { _decorator, Component, Node, Label, Color, UITransform, Graphics, EventTouch } from 'cc';
import { EventBus } from '../Core/EventBus';
import { RoguelikeRewardSystem, RewardOption, ModifierRarity } from '../Player/RoguelikeRewardSystem';

const { ccclass } = _decorator;

@ccclass('RewardSelectionPanel')
export class RewardSelectionPanel extends Component {
    private _bgNode: Node | null = null;
    private _titleLabel: Label | null = null;
    private _cardNodes: Node[] = [];
    private _isShowing: boolean = false;

    protected onLoad(): void {
        this._buildUI();
        EventBus.on('REWARD_SHOW', this._onRewardShow, this);
    }

    protected onDestroy(): void {
        EventBus.off('REWARD_SHOW', this._onRewardShow, this);
    }

    // ────────────────────────────────
    //  UI 构建
    // ────────────────────────────────

    private _buildUI(): void {
        const canvas = this.node.scene?.getChildByName('Canvas');
        if (!canvas) return;
        this.node.parent = canvas;
        this.node.setSiblingIndex(999);

        // 半透明遮罩
        this._bgNode = new Node('BG');
        this.node.addChild(this._bgNode);
        const bgUt = this._bgNode.addComponent(UITransform);
        bgUt.setContentSize(800, 600);
        const bgG = this._bgNode.addComponent(Graphics);
        bgG.fillColor = new Color(0, 0, 0, 180);
        bgG.rect(-400, -300, 800, 600);
        bgG.fill();

        // 标题
        this._titleLabel = this._createLabel('Title', new Color(255, 220, 100, 255), 36);
        this._titleLabel.node.setPosition(0, 220, 0);
        this._titleLabel.string = '选择奖励';

        // 初始隐藏
        this.node.active = false;
    }

    private _createLabel(name: string, color: Color, fontSize: number): Label {
        const node = new Node(name);
        this.node.addChild(node);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(400, 50);
        const label = node.addComponent(Label);
        label.color = color;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 4;
        label.string = '';
        return label;
    }

    // ────────────────────────────────
    //  事件处理
    // ────────────────────────────────

    private _onRewardShow(payload: { wave: number; options: RewardOption[] }): void {
        this._clearCards();
        this._titleLabel!.string = `第 ${payload.wave} 波完成 — 选择奖励`;

        const spacing = 260;
        const startX = -((payload.options.length - 1) * spacing) / 2;

        for (let i = 0; i < payload.options.length; i++) {
            const opt = payload.options[i];
            const card = this._createCard(opt, i);
            card.setPosition(startX + i * spacing, 0, 0);
            this._cardNodes.push(card);
        }

        this.node.active = true;
        this._isShowing = true;
    }

    // ────────────────────────────────
    //  卡片创建
    // ────────────────────────────────

    private _createCard(option: RewardOption, index: number): Node {
        const card = new Node(`Card_${index}`);
        this.node.addChild(card);

        const cardUt = card.addComponent(UITransform);
        cardUt.setContentSize(220, 300);

        // 卡片背景
        const rarityColor = this._getRarityColor(option.modifier.rarity);
        const g = card.addComponent(Graphics);
        g.fillColor = new Color(40, 40, 60, 240);
        g.roundRect(-110, -150, 220, 300, 12);
        g.fill();
        g.strokeColor = rarityColor;
        g.lineWidth = 3;
        g.roundRect(-110, -150, 220, 300, 12);
        g.stroke();

        // 稀有度标签
        const rarityLabel = this._createLabelOnNode(card, 'Rarity', rarityColor, 18);
        rarityLabel.node.setPosition(0, 120, 0);
        rarityLabel.string = this._getRarityText(option.modifier.rarity);

        // 名称
        const nameLabel = this._createLabelOnNode(card, 'Name', new Color(255, 255, 255, 255), 24);
        nameLabel.node.setPosition(0, 80, 0);
        nameLabel.string = option.modifier.name;

        // 描述
        const descLabel = this._createLabelOnNode(card, 'Desc', new Color(200, 200, 200, 255), 18);
        descLabel.node.setPosition(0, 20, 0);
        descLabel.string = option.modifier.description;
        descLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
        descLabel.getComponent(UITransform)!.setContentSize(180, 80);

        // 点击事件（整个卡片可点）
        card.on(Node.EventType.TOUCH_END, () => {
            if (!this._isShowing) return;
            this._isShowing = false;
            RoguelikeRewardSystem.selectOption(index);
            this.node.active = false;
            this._clearCards();
        }, this);

        return card;
    }

    private _createLabelOnNode(parent: Node, name: string, color: Color, fontSize: number): Label {
        const node = new Node(name);
        parent.addChild(node);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(200, 40);
        const label = node.addComponent(Label);
        label.color = color;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 4;
        label.string = '';
        return label;
    }

    private _getRarityColor(rarity: ModifierRarity): Color {
        switch (rarity) {
            case ModifierRarity.COMMON: return new Color(180, 180, 180, 255);
            case ModifierRarity.RARE: return new Color(80, 160, 255, 255);
            case ModifierRarity.LEGENDARY: return new Color(255, 180, 40, 255);
            default: return new Color(255, 255, 255, 255);
        }
    }

    private _getRarityText(rarity: ModifierRarity): string {
        switch (rarity) {
            case ModifierRarity.COMMON: return '普通';
            case ModifierRarity.RARE: return '稀有';
            case ModifierRarity.LEGENDARY: return '传说';
            default: return '';
        }
    }

    private _clearCards(): void {
        for (const card of this._cardNodes) {
            if (card.isValid) {
                card.removeFromParent();
            }
        }
        this._cardNodes.length = 0;
    }
}
