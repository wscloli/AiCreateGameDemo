/**
 * GameOverPanel.ts
 *
 * 游戏结束面板 —— 显示 GameOver / 通关结果 + 重新开始按钮
 *
 * 使用 Cocos 原生 Label + Button 事件区域实现。
 * 监听：GAME_OVER, GAME_WIN
 */

import { _decorator, Component, Node, Label, Color, UITransform, EventTouch, Graphics } from 'cc';
import { EventBus } from '../Core/EventBus';
import { GameManager } from '../Core/GameManager';

const { ccclass } = _decorator;

@ccclass('GameOverPanel')
export class GameOverPanel extends Component {
    private _bgNode: Node | null = null;
    private _titleLabel: Label | null = null;
    private _infoLabel: Label | null = null;
    private _btnLabel: Label | null = null;
    private _btnNode: Node | null = null;

    private _isWin: boolean = false;

    protected onLoad(): void {
        this._buildUI();
        EventBus.on('GAME_OVER', this._onGameOver, this);
        EventBus.on('GAME_WIN', this._onGameWin, this);
    }

    protected onDestroy(): void {
        EventBus.off('GAME_OVER', this._onGameOver, this);
        EventBus.off('GAME_WIN', this._onGameWin, this);
    }

    // ────────────────────────────────
    //  UI 构建
    // ────────────────────────────────

    private _buildUI(): void {
        const canvas = this.node.scene?.getChildByName('Canvas');
        if (!canvas) return;
        this.node.parent = canvas;
        this.node.setSiblingIndex(1000);

        // 半透明背景遮罩
        this._bgNode = new Node('BG');
        this.node.addChild(this._bgNode);
        const bgUt = this._bgNode.addComponent(UITransform);
        bgUt.setContentSize(800, 600);
        const bgG = this._bgNode.addComponent(Graphics);
        bgG.fillColor = new Color(0, 0, 0, 200);
        bgG.rect(-400, -300, 800, 600);
        bgG.fill();

        // 标题
        this._titleLabel = this._createLabel('Title', new Color(255, 80, 80, 255), 48);
        this._titleLabel.node.setPosition(0, 120, 0);

        // 信息（波次、用时）
        this._infoLabel = this._createLabel('Info', new Color(220, 220, 220, 255), 24);
        this._infoLabel.node.setPosition(0, 20, 0);

        // 重新开始按钮区域
        this._btnNode = new Node('RestartBtn');
        this.node.addChild(this._btnNode);
        const btnUt = this._btnNode.addComponent(UITransform);
        btnUt.setContentSize(240, 60);
        this._btnNode.setPosition(0, -100, 0);

        const btnG = this._btnNode.addComponent(Graphics);
        btnG.fillColor = new Color(60, 120, 200, 255);
        btnG.roundRect(-120, -30, 240, 60, 10);
        btnG.fill();

        this._btnLabel = this._createLabel('BtnText', new Color(255, 255, 255, 255), 28);
        this._btnLabel.node.setPosition(0, -100, 0);
        this._btnLabel.string = '重新开始';

        // 点击事件
        this._btnNode.on(Node.EventType.TOUCH_END, this._onRestartClick, this);

        // 初始隐藏
        this.node.active = false;
    }

    private _createLabel(name: string, color: Color, fontSize: number): Label {
        const node = new Node(name);
        this.node.addChild(node);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(600, 60);
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

    private _onGameOver(payload: { gameTime: number; wave: number }): void {
        this._isWin = false;
        this._showPanel('游戏结束', payload.wave, payload.gameTime);
    }

    private _onGameWin(payload: { gameTime: number; wavesCompleted: number }): void {
        this._isWin = true;
        this._showPanel('恭喜通关！', payload.wavesCompleted, payload.gameTime);
    }

    private _showPanel(title: string, wave: number, time: number): void {
        if (!this._titleLabel || !this._infoLabel) return;

        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        const mm = minutes < 10 ? '0' + minutes : '' + minutes;
        const ss = seconds < 10 ? '0' + seconds : '' + seconds;

        this._titleLabel.string = title;
        this._titleLabel.color = this._isWin ? new Color(80, 255, 120, 255) : new Color(255, 80, 80, 255);
        this._infoLabel.string = `存活波次: ${wave}\n游戏用时: ${mm}:${ss}`;
        this._infoLabel.lineHeight = 32;

        this.node.active = true;
    }

    private _onRestartClick(_event: EventTouch): void {
        this.node.active = false;
        GameManager.instance?.restartGame();
    }
}
