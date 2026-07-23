/**
 * RewardSelectionPanel.ts
 *
 * 波次结束后的奖励选择面板 —— 显示 3 个可选修改器卡片
 *
 * 监听：REWARD_SHOW
 * 派发：RoguelikeRewardSystem.selectOption(index)
 */

import { _decorator, Component, Node, Label, Color, UITransform, Graphics, EventTouch, EventMouse, input, Input, view, screen, Canvas, Vec3 } from 'cc';
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
    private _panelW: number = 800;
    private _panelH: number = 800;
    /** 面板显示后忽略输入的冷却时间（秒），防止波次结束时移动手指的抬升误触卡片 */
    private static readonly _inputCooldown: number = 0.25;
    private _showTime: number = 0;
    private _selectedIndex: number = -1;
    private _confirmBtnNode: Node | null = null;
    private _confirmBtnBg: Graphics | null = null;
    private _confirmBtnLabel: Label | null = null;

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

        // 以当前相机视口为基准，确保遮罩和卡片布局在不同分辨率下都可见且不溢出
        const canvasComp = canvas.getComponent(Canvas);
        const cam = canvasComp?.cameraComponent;
        const ws = screen.windowSize;
        let halfW = 400;
        let halfH = 400;
        if (cam && ws.width > 0 && ws.height > 0) {
            halfH = cam.orthoHeight;
            halfW = halfH * (ws.width / ws.height);
        } else {
            const designSize = view.getDesignResolutionSize();
            halfW = designSize.width / 2;
            halfH = designSize.height / 2;
        }

        this._panelW = halfW * 2;
        this._panelH = halfH * 2;

        // 全屏不透明遮罩，彻底盖住角色和敌人
        this._bgNode = new Node('BG');
        this.node.addChild(this._bgNode);
        const bgUt = this._bgNode.addComponent(UITransform);
        bgUt.setContentSize(this._panelW, this._panelH);
        const bgG = this._bgNode.addComponent(Graphics);
        bgG.fillColor = new Color(0, 0, 0, 230);
        bgG.rect(-halfW, -halfH, this._panelW, this._panelH);
        bgG.fill();

        // 标题（距顶部 12% 视口高度）
        this._titleLabel = this._createLabel('Title', new Color(255, 220, 100, 255), 36);
        this._titleLabel.node.setPosition(0, halfH * 0.78, 0);
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

        // 以相机视口为基准计算卡片布局，确保不超出屏幕
        const canvas = this.node.scene?.getChildByName('Canvas');
        const canvasComp = canvas?.getComponent(Canvas);
        const cam = canvasComp?.cameraComponent;
        const ws = screen.windowSize;
        let halfW = this._panelW / 2;
        let halfH = this._panelH / 2;
        if (cam && ws.width > 0 && ws.height > 0) {
            halfH = cam.orthoHeight;
            halfW = halfH * (ws.width / ws.height);
        }

        const cardCount = payload.options.length;
        // 卡片更宽松：占满可用横向空间，纵向占视口 55%
        const maxCardW = (halfW * 2) / cardCount;
        const maxCardH = halfH * 2 * 0.55;
        const cardWidth = Math.min(260, maxCardW * 0.86);
        const cardHeight = Math.min(260, maxCardH * 0.86);
        const spacing = cardWidth + Math.min(32, halfW * 0.08);
        const totalWidth = (cardCount - 1) * spacing;
        const startX = -totalWidth / 2;
        const cardY = -halfH * 0.04;

        for (let i = 0; i < cardCount; i++) {
            const opt = payload.options[i];
            const card = this._createCard(opt, i, cardWidth, cardHeight);
            card.setPosition(startX + i * spacing, cardY, 0);
            this._cardNodes.push(card);
        }

        this.node.active = true;
        this.node.setSiblingIndex(9999);
        this._isShowing = true;
        this._showTime = performance.now() / 1000;
        this._selectedIndex = -1;

        // 注册全局输入事件（同时支持触摸和鼠标，绕过 Cocos 节点事件不冒泡的问题）
        input.on(Input.EventType.TOUCH_END, this._onGlobalTouchEnd, this);
        input.on(Input.EventType.MOUSE_UP, this._onGlobalMouseUp, this);

        // 底部确定按钮
        this._createConfirmButton(halfH);

        console.log('[RewardSelectionPanel] 面板已显示，等待选择...');
    }

    /**
     * 全局 TOUCH_END 回调：手动检测点击位置是否在卡片范围内
     * 原因：Cocos 3.x 节点事件不冒泡，_bgNode/Label 会拦截卡片事件，导致卡片 on(TOUCH_END) 无法触发
     */
    private _onGlobalTouchEnd(event: EventTouch): void {
        if (!this._isShowing || this._isInCooldown()) return;
        // 使用 Cocos 内置坐标转换，避免 UI 坐标系与 panel 尺寸不一致导致偏移
        const localPos = this._convertToLocal(event.getUILocation());
        this._trySelectCard(localPos.x, localPos.y);
    }

    private _onGlobalMouseUp(event: EventMouse): void {
        if (!this._isShowing || this._isInCooldown()) return;
        // 鼠标屏幕坐标 → UI 坐标（左下角原点）
        const screenLoc = event.getLocation();
        const screenSize = screen.windowSize;
        const uiPos = {
            x: screenLoc.x * (this._panelW / screenSize.width),
            y: (screenSize.height - screenLoc.y) * (this._panelH / screenSize.height),
        };
        const localPos = this._convertToLocal(uiPos);
        this._trySelectCard(localPos.x, localPos.y);
    }

    /** 面板刚显示时忽略输入，避免移动手指的释放事件误选奖励 */
    private _isInCooldown(): boolean {
        const elapsed = (performance.now() / 1000) - this._showTime;
        return elapsed < RewardSelectionPanel._inputCooldown;
    }

    /**
     * 将 UI 坐标（左下角原点）转换为 this.node 局部坐标。
     * 这里使用节点自身的 UITransform.convertToNodeSpaceAR，与 Cocos 适配层保持一致。
     */
    private _convertToLocal(uiPos: { x: number; y: number }): { x: number; y: number } {
        const out = new Vec3();
        // UI 坐标是 Vec3（z=0），传入 convertToNodeSpaceAR 得到局部坐标
        this.node.getComponent(UITransform)?.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0), out);
        return { x: out.x, y: out.y };
    }

    private _trySelectCard(localX: number, localY: number): void {
        // 优先检测是否点击了确定按钮
        if (this._confirmBtnNode && this._confirmBtnNode.active) {
            const btnPos = this._confirmBtnNode.position;
            const btnUt = this._confirmBtnNode.getComponent(UITransform);
            if (btnUt) {
                const halfBW = btnUt.width / 2;
                const halfBH = btnUt.height / 2;
                if (localX >= btnPos.x - halfBW && localX <= btnPos.x + halfBW &&
                    localY >= btnPos.y - halfBH && localY <= btnPos.y + halfBH) {
                    this._onConfirmClick();
                    return;
                }
            }
        }

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
                this._selectCard(i);
                return;
            }
        }
    }

    private _selectCard(index: number): void {
        if (this._selectedIndex === index) return;

        // 取消旧选中框
        if (this._selectedIndex >= 0 && this._selectedIndex < this._cardNodes.length) {
            const oldCard = this._cardNodes[this._selectedIndex];
            const oldBorder = oldCard.getChildByName('SelectionBorder');
            if (oldBorder) oldBorder.active = false;
        }

        // 设置新选中框
        this._selectedIndex = index;
        const newCard = this._cardNodes[index];
        const newBorder = newCard.getChildByName('SelectionBorder');
        if (newBorder) newBorder.active = true;

        console.log(`[RewardSelectionPanel] 选中卡片 ${index}`);
        this._updateConfirmButtonState();
    }

    private _createConfirmButton(halfH: number): void {
        const btnNode = new Node('ConfirmButton');
        this.node.addChild(btnNode);
        btnNode.setPosition(0, -halfH * 0.62, 0);

        const btnW = 220;
        const btnH = 64;
        const btnUt = btnNode.addComponent(UITransform);
        btnUt.setContentSize(btnW, btnH);

        const bgG = btnNode.addComponent(Graphics);
        this._confirmBtnBg = bgG;

        const label = this._createLabelOnNode(btnNode, 'ConfirmLabel', new Color(255, 255, 255, 255), 24);
        label.string = '确定';
        label.node.setPosition(0, 0, 0);
        this._confirmBtnLabel = label;

        this._confirmBtnNode = btnNode;
        this._updateConfirmButtonState();
    }

    private _updateConfirmButtonState(): void {
        if (!this._confirmBtnBg || !this._confirmBtnLabel) return;
        const enabled = this._selectedIndex >= 0;
        const btnW = 220;
        const btnH = 64;
        const halfBW = btnW / 2;
        const halfBH = btnH / 2;

        this._confirmBtnBg.clear();
        this._confirmBtnBg.fillColor = enabled ? new Color(60, 140, 60, 255) : new Color(80, 80, 80, 255);
        this._confirmBtnBg.roundRect(-halfBW, -halfBH, btnW, btnH, 12);
        this._confirmBtnBg.fill();
        this._confirmBtnBg.strokeColor = enabled ? new Color(100, 220, 100, 255) : new Color(120, 120, 120, 255);
        this._confirmBtnBg.lineWidth = 3;
        this._confirmBtnBg.roundRect(-halfBW, -halfBH, btnW, btnH, 12);
        this._confirmBtnBg.stroke();

        this._confirmBtnLabel.color = enabled ? new Color(255, 255, 255, 255) : new Color(160, 160, 160, 255);
    }

    private _onConfirmClick(): void {
        if (this._selectedIndex < 0) {
            console.log('[RewardSelectionPanel] 未选择任何奖励，忽略确定');
            return;
        }
        console.log(`[RewardSelectionPanel] 确认选择卡片 ${this._selectedIndex}`);
        this._isShowing = false;
        RoguelikeRewardSystem.selectOption(this._selectedIndex);
        this.node.active = false;
        this._clearCards();
        this._selectedIndex = -1;
        input.off(Input.EventType.TOUCH_END, this._onGlobalTouchEnd, this);
        input.off(Input.EventType.MOUSE_UP, this._onGlobalMouseUp, this);
        this._respawnPlayer();
    }

    // ────────────────────────────────
    //  卡片创建
    // ────────────────────────────────

    private _createCard(option: RewardOption, index: number, cardWidth: number = 220, cardHeight: number = 300): Node {
        const card = new Node(`Card_${index}`);
        this.node.addChild(card);

        const halfW = cardWidth / 2;
        const halfH = cardHeight / 2;
        const cardUt = card.addComponent(UITransform);
        cardUt.setContentSize(cardWidth, cardHeight);

        // 卡片背景
        const rarityColor = this._getRarityColor(option.modifier.rarity);
        const g = card.addComponent(Graphics);
        g.fillColor = new Color(40, 40, 60, 240);
        g.roundRect(-halfW, -halfH, cardWidth, cardHeight, 12);
        g.fill();
        g.strokeColor = rarityColor;
        g.lineWidth = 3;
        g.roundRect(-halfW, -halfH, cardWidth, cardHeight, 12);
        g.stroke();

        // 稀有度标签（距顶部 18%）
        const rarityLabel = this._createLabelOnNode(card, 'Rarity', rarityColor, 16);
        rarityLabel.node.setPosition(0, halfH * 0.78, 0);
        rarityLabel.string = this._getRarityText(option.modifier.rarity);

        // 名称（距顶部 38%）
        const nameLabel = this._createLabelOnNode(card, 'Name', new Color(255, 255, 255, 255), 22);
        nameLabel.node.setPosition(0, halfH * 0.48, 0);
        nameLabel.string = option.modifier.name;

        // 描述（居中偏下）
        const descLabel = this._createLabelOnNode(card, 'Desc', new Color(200, 200, 200, 255), 16);
        descLabel.node.setPosition(0, -halfH * 0.12, 0);
        descLabel.string = option.modifier.description;
        descLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
        descLabel.getComponent(UITransform)!.setContentSize(cardWidth - 28, halfH * 0.45);

        // 选中框（默认隐藏）
        const borderNode = new Node('SelectionBorder');
        card.addChild(borderNode);
        borderNode.setPosition(0, 0, 0);
        const borderUt = borderNode.addComponent(UITransform);
        borderUt.setContentSize(cardWidth + 10, cardHeight + 10);
        const borderG = borderNode.addComponent(Graphics);
        borderG.strokeColor = new Color(255, 220, 80, 255);
        borderG.lineWidth = 4;
        borderG.roundRect(-(cardWidth + 10) / 2, -(cardHeight + 10) / 2, cardWidth + 10, cardHeight + 10, 16);
        borderG.stroke();
        borderNode.active = false;

        return card;
    }

    private _createLabelOnNode(parent: Node, name: string, color: Color, fontSize: number): Label {
        const node = new Node(name);
        parent.addChild(node);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(240, 40);
        const label = node.addComponent(Label);
        label.color = color;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 6;
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
        this._selectedIndex = -1;
        if (this._confirmBtnNode && this._confirmBtnNode.isValid) {
            this._confirmBtnNode.removeFromParent();
            this._confirmBtnNode = null;
            this._confirmBtnBg = null;
            this._confirmBtnLabel = null;
        }
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
