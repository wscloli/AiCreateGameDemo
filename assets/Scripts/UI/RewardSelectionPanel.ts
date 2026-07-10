/**
 * RewardSelectionPanel.ts
 *
 * 波次结束后的奖励选择面板 —— 显示 3 个可选修改器卡片
 *
 * 监听：REWARD_SHOW
 * 派发：RoguelikeRewardSystem.selectOption(index)
 */

import { _decorator, Component, Node, Label, Color, UITransform, Graphics, EventTouch, EventMouse, input, Input, view, screen } from 'cc';
import { EventBus } from '../Core/EventBus';
import { RoguelikeRewardSystem, RewardOption, ModifierRarity } from '../Player/RoguelikeRewardSystem';
import { EnemyManager } from '../Enemy/EnemyManager';
import { BulletFactory } from '../Player/BulletFactory';
import { VFXManager } from '../Core/VFXManager';
import { PlayerController } from '../Player/PlayerController';

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
        input.off(Input.EventType.TOUCH_END, this._onGlobalTouchEnd, this);
        input.off(Input.EventType.MOUSE_UP, this._onGlobalMouseUp, this);
    }

    // ────────────────────────────────
    //  UI 构建
    // ────────────────────────────────

    private _buildUI(): void {
        const canvas = this.node.scene?.getChildByName('Canvas');
        if (!canvas) return;
        this.node.parent = canvas;
        this.node.setSiblingIndex(9999);

        // 全屏不透明遮罩，彻底盖住角色和敌人
        this._bgNode = new Node('BG');
        this.node.addChild(this._bgNode);
        const bgUt = this._bgNode.addComponent(UITransform);
        bgUt.setContentSize(800, 600);
        const bgG = this._bgNode.addComponent(Graphics);
        bgG.fillColor = new Color(0, 0, 0, 230);
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
        if (payload.wave === 0) {
            this._titleLabel!.string = '战斗前准备 — 选择初始奖励';
        } else {
            this._titleLabel!.string = `第 ${payload.wave} 波完成 — 选择奖励`;
        }

        // 回收所有敌人和子弹，防止干扰选择
        this._clearGameEntities();

        const spacing = 260;
        const startX = -((payload.options.length - 1) * spacing) / 2;

        for (let i = 0; i < payload.options.length; i++) {
            const opt = payload.options[i];
            const card = this._createCard(opt, i);
            card.setPosition(startX + i * spacing, 0, 0);
            this._cardNodes.push(card);
        }

        this.node.active = true;
        this.node.setSiblingIndex(9999);
        this._isShowing = true;

        // 注册全局输入事件（同时支持触摸和鼠标，绕过 Cocos 节点事件不冒泡的问题）
        input.on(Input.EventType.TOUCH_END, this._onGlobalTouchEnd, this);
        input.on(Input.EventType.MOUSE_UP, this._onGlobalMouseUp, this);
        console.log('[RewardSelectionPanel] 面板已显示，等待选择...');
    }

    /**
     * 全局 TOUCH_END 回调：手动检测点击位置是否在卡片范围内
     * 原因：Cocos 3.x 节点事件不冒泡，_bgNode/Label 会拦截卡片事件，导致卡片 on(TOUCH_END) 无法触发
     */
    private _onGlobalTouchEnd(event: EventTouch): void {
        if (!this._isShowing) return;
        const touchPos = event.getUILocation();
        const designSize = view.getDesignResolutionSize();
        // UI 坐标 → this.node 局部坐标（this.node 在 Canvas 中心）
        const localX = touchPos.x - designSize.width / 2;
        const localY = designSize.height / 2 - touchPos.y;
        this._trySelectCard(localX, localY);
    }

    private _onGlobalMouseUp(event: EventMouse): void {
        if (!this._isShowing) return;
        const screenLoc = event.getLocation();
        const screenSize = screen.windowSize;
        const designSize = view.getDesignResolutionSize();
        // 屏幕像素 → UI 坐标（左下角原点）
        const uiX = screenLoc.x * (designSize.width / screenSize.width);
        const uiY = (screenSize.height - screenLoc.y) * (designSize.height / screenSize.height);
        // UI 坐标 → this.node 局部坐标
        const localX = uiX - designSize.width / 2;
        const localY = designSize.height / 2 - uiY;
        this._trySelectCard(localX, localY);
    }

    private _trySelectCard(localX: number, localY: number): void {
        for (let i = 0; i < this._cardNodes.length; i++) {
            const card = this._cardNodes[i];
            if (!card.isValid) continue;

            const cardPos = card.position;
            const cardUt = card.getComponent(UITransform);
            if (!cardUt) continue;

            const halfW = cardUt.width / 2;
            const halfH = cardUt.height / 2;

            if (localX >= cardPos.x - halfW && localX <= cardPos.x + halfW &&
                localY >= cardPos.y - halfH && localY <= cardPos.y + halfH) {
                console.log(`[RewardSelectionPanel] 选择了卡片 ${i}`);
                this._isShowing = false;
                RoguelikeRewardSystem.selectOption(i);
                this.node.active = false;
                this._clearCards();
                input.off(Input.EventType.TOUCH_END, this._onGlobalTouchEnd, this);
                input.off(Input.EventType.MOUSE_UP, this._onGlobalMouseUp, this);
                // 恢复玩家到场景中心
                this._respawnPlayer();
                return;
            }
        }
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

        // 点击检测已移至全局 _onGlobalTouchEnd，卡片本身不再注册 node.on 事件
        // 原因：Cocos 3.x 节点事件不冒泡，_bgNode/Label 会阻断事件到达卡片

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

    /** 回收敌人、子弹、特效，并隐藏玩家 */
    private _clearGameEntities(): void {
        EnemyManager.despawnAll();
        BulletFactory.despawnAllBullets();
        VFXManager.instance?.clearAll();

        const pc = PlayerController.instance;
        if (pc && pc.node) {
            pc.node.active = false;
        }
    }

    /** 将玩家恢复到场景中心 */
    private _respawnPlayer(): void {
        const pc = PlayerController.instance;
        if (pc && pc.node) {
            pc.node.setPosition(0, 0, 0);
            pc.node.active = true;
        }
    }
}
