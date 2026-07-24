/**
 * RewardSelectionPanel.ts
 *
 * 波次结束后的奖励选择面板 —— 显示 3 个可选修改器卡片
 *
 * 监听：REWARD_SHOW
 * 派发：RoguelikeRewardSystem.selectOption(index)
 */

import { _decorator, Component, Node, Label, Color, UITransform, Graphics, view, screen, Canvas, Vec3, input, Input } from 'cc';
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
        // 屏蔽全局触摸输入，防止 PlayerController / VirtualJoystick 在奖励界面处理触摸
        input.on(Input.EventType.TOUCH_START, this._onPanelTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this._onPanelTouchEnd, this);
    }

    protected onDestroy(): void {
        EventBus.off('REWARD_SHOW', this._onRewardShow, this);
        input.off(Input.EventType.TOUCH_START, this._onPanelTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this._onPanelTouchEnd, this);
    }

    // ────────────────────────────────
    //  UI 构建
    // ────────────────────────────────

    private _buildUI(): void {
        const canvas = this.node.scene?.getChildByName('Canvas');
        if (!canvas) return;
        this.node.parent = canvas;
        this.node.setSiblingIndex(9999);

        // 面板节点本身必须能接收 UI 事件，才能正确分发到子节点卡片
        let panelUt = this.node.getComponent(UITransform);
        if (!panelUt) {
            panelUt = this.node.addComponent(UITransform);
        }
        panelUt.setContentSize(2000, 2000);

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
        console.log('[RewardSelectionPanel] _onRewardShow 被调用');
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
        console.log(`[RewardSelectionPanel] node.active=${this.node.active}, parent=${this.node.parent?.name}, hasUITransform=${!!this.node.getComponent(UITransform)}`);
        this._isShowing = true;
        this._showTime = performance.now() / 1000;
        this._selectedIndex = -1;

        // 底部确定按钮
        this._createConfirmButton(halfH);

        console.log('[RewardSelectionPanel] 面板已显示，等待选择...');
    }

    /** 面板刚显示时忽略输入，避免移动手指的释放事件误选奖励 */
    private _isInCooldown(): boolean {
        const elapsed = (performance.now() / 1000) - this._showTime;
        return elapsed < RewardSelectionPanel._inputCooldown;
    }

    /** 将全局屏幕像素坐标转换为面板局部坐标（适配 Cocos Canvas 坐标系） */
    private _screenToPanelLocal(screenPos: { x: number; y: number }): Vec3 | null {
        const canvas = this.node.parent;
        if (!canvas) return null;
        const canvasUt = canvas.getComponent(UITransform);
        if (!canvasUt) return null;

        const ws = screen.windowSize;
        if (ws.width <= 0 || ws.height <= 0) return null;

        const canvasComp = canvas.getComponent(Canvas);
        const cam = canvasComp?.cameraComponent;
        if (!cam) return null;

        // 屏幕像素 -> 以屏幕中心为原点的归一化偏移（-1 ~ 1）
        const nx = (screenPos.x / ws.width - 0.5) * 2;
        const ny = (screenPos.y / ws.height - 0.5) * 2;

        // 相机在当前分辨率下的可视半宽高（世界单位）
        const halfH = cam.orthoHeight;
        const halfW = halfH * (ws.width / ws.height);

        // 面板在 Canvas 下的局部坐标 = 面板锚点位置
        const panelPos = this.node.getPosition();

        // 触摸点在面板局部坐标系中的位置
        return new Vec3(
            cam.node.position.x + nx * halfW - panelPos.x,
            cam.node.position.y + ny * halfH - panelPos.y,
            0,
        );
    }

    /** 根据全局触摸坐标判断点击了哪张卡片，-1 表示没有点中卡片 */
    private _hitCardIndex(screenPos: { x: number; y: number }): number {
        const panelLocal = this._screenToPanelLocal(screenPos);
        if (!panelLocal) return -1;

        for (let i = 0; i < this._cardNodes.length; i++) {
            const card = this._cardNodes[i];
            if (!card.isValid) continue;
            const cardUt = card.getComponent(UITransform);
            if (!cardUt) continue;
            const cardPos = card.getPosition();
            const halfW = cardUt.contentSize.width / 2;
            const halfH = cardUt.contentSize.height / 2;
            const localInCard = new Vec3(panelLocal.x - cardPos.x, panelLocal.y - cardPos.y, 0);
            if (localInCard.x >= -halfW && localInCard.x <= halfW &&
                localInCard.y >= -halfH && localInCard.y <= halfH) {
                return i;
            }
        }
        return -1;
    }

    /** 判断点击是否在确定按钮内 */
    private _hitConfirmButton(screenPos: { x: number; y: number }): boolean {
        if (!this._confirmBtnNode || !this._confirmBtnNode.isValid) return false;
        const panelLocal = this._screenToPanelLocal(screenPos);
        if (!panelLocal) return false;
        const btnPos = this._confirmBtnNode.getPosition();
        const btnUt = this._confirmBtnNode.getComponent(UITransform);
        if (!btnUt) return false;
        const halfW = btnUt.contentSize.width / 2;
        const halfH = btnUt.contentSize.height / 2;
        const localInBtn = new Vec3(panelLocal.x - btnPos.x, panelLocal.y - btnPos.y, 0);
        return localInBtn.x >= -halfW && localInBtn.x <= halfW &&
               localInBtn.y >= -halfH && localInBtn.y <= halfH;
    }

    private _onPanelTouchStart(event: any): void {
        if (!this._isShowing || this._isInCooldown()) return;
        const loc = event.getLocation ? event.getLocation() : { x: event.x, y: event.y };
        console.log(`[RewardSelectionPanel] 全局 TOUCH_START: ${loc.x}, ${loc.y}`);
    }

    private _onPanelTouchEnd(event: any): void {
        if (!this._isShowing || this._isInCooldown()) return;
        const loc = event.getLocation ? event.getLocation() : { x: event.x, y: event.y };
        console.log(`[RewardSelectionPanel] 全局 TOUCH_END: ${loc.x}, ${loc.y}`);
        const panelLocal = this._screenToPanelLocal(loc);
        console.log(`[RewardSelectionPanel] 转换后面板局部坐标: ${panelLocal?.x.toFixed(2)}, ${panelLocal?.y.toFixed(2)}`);
        const cardIndex = this._hitCardIndex(loc);
        if (cardIndex >= 0) {
            console.log(`[RewardSelectionPanel] 命中卡片 ${cardIndex}`);
            this._selectCard(cardIndex);
            return;
        }
        if (this._hitConfirmButton(loc)) {
            console.log('[RewardSelectionPanel] 命中确定按钮');
            this._onConfirmClick();
            return;
        }
        console.log('[RewardSelectionPanel] 未命中任何可点击区域');
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

        // 注册节点点击事件（同时监听 TOUCH_START，防止某些设备上 TOUCH_END 不冒泡）
        const onBtnClick = () => {
            if (this._isInCooldown()) return;
            console.log('[RewardSelectionPanel] 确定按钮点击触发');
            this._onConfirmClick();
        };
        btnNode.on(Node.EventType.TOUCH_START, onBtnClick, this);
        btnNode.on(Node.EventType.TOUCH_END, onBtnClick, this);
        btnNode.on(Node.EventType.MOUSE_UP, onBtnClick, this);
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

        // 注册节点点击事件（同时监听 TOUCH_START，防止某些设备上 TOUCH_END 不冒泡）
        const onCardClick = () => {
            if (this._isInCooldown()) return;
            console.log(`[RewardSelectionPanel] 卡片 ${index} 点击触发`);
            this._selectCard(index);
        };
        card.on(Node.EventType.TOUCH_START, onCardClick, this);
        card.on(Node.EventType.TOUCH_END, onCardClick, this);
        card.on(Node.EventType.MOUSE_UP, onCardClick, this);

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
                card.off(Node.EventType.TOUCH_START);
                card.off(Node.EventType.TOUCH_END);
                card.off(Node.EventType.MOUSE_UP);
                card.removeFromParent();
            }
        }
        this._cardNodes.length = 0;
        this._selectedIndex = -1;
        if (this._confirmBtnNode && this._confirmBtnNode.isValid) {
            this._confirmBtnNode.off(Node.EventType.TOUCH_START);
            this._confirmBtnNode.off(Node.EventType.TOUCH_END);
            this._confirmBtnNode.off(Node.EventType.MOUSE_UP);
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
