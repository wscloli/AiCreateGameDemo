/**
 * BattleHUD.ts
 *
 * 战斗 HUD —— 波次显示 + 计时器 + 击杀统计
 *
 * 使用 Cocos 原生 Label 组件，纯代码驱动文本更新。
 * 监听事件：WAVE_START, ENEMY_DIED, GAME_START
 */

import { _decorator, Component, Node, Label, Color, UITransform, view, screen, Canvas } from 'cc';
import { EventBus } from '../Core/EventBus';
import { GameManager } from '../Core/GameManager';
import { RoguelikeRewardSystem } from '../Player/RoguelikeRewardSystem';

const { ccclass } = _decorator;

@ccclass('BattleHUD')
export class BattleHUD extends Component {
    private _waveLabel: Label | null = null;
    private _timerLabel: Label | null = null;
    private _killLabel: Label | null = null;
    private _modifierLabel: Label | null = null;

    private _killCount: number = 0;
    private _gameTime: number = 0;
    private _currentWave: number = 0;

    protected onLoad(): void {
        this._buildUI();
        EventBus.on('WAVE_START', this._onWaveStart, this);
        EventBus.on('ENEMY_DIED', this._onEnemyDied, this);
        EventBus.on('GAME_START', this._onGameStart, this);
        EventBus.on('REWARD_SELECTED', this._onRewardSelected, this);
    }

    protected onDestroy(): void {
        EventBus.off('WAVE_START', this._onWaveStart, this);
        EventBus.off('ENEMY_DIED', this._onEnemyDied, this);
        EventBus.off('GAME_START', this._onGameStart, this);
        EventBus.off('REWARD_SELECTED', this._onRewardSelected, this);
    }

    protected update(dt: number): void {
        if (GameManager.instance?.gameState === 'PLAYING') {
            this._gameTime += dt;
            this._updateTimer();
        }
    }

    // ────────────────────────────────
    //  UI 构建
    // ────────────────────────────────

    private _buildUI(): void {
        const canvas = this.node.scene?.getChildByName('Canvas');
        if (!canvas) return;

        // 确保 HUD 挂在 Canvas 下最顶层
        this.node.parent = canvas;
        this.node.setSiblingIndex(999);

        // 以当前相机视口为基准计算安全区域，避免设计分辨率与实际视口不一致导致溢出或消失
        const canvasComp = canvas.getComponent(Canvas);
        const cam = canvasComp?.cameraComponent;
        const ws = screen.windowSize;
        let halfW = 400;
        let halfH = 400;
        if (cam && ws.width > 0 && ws.height > 0) {
            halfH = cam.orthoHeight;
            halfW = halfH * (ws.width / ws.height);
        } else {
            // 相机未就绪时回退到设计分辨率
            const designSize = view.getDesignResolutionSize();
            halfW = designSize.width / 2;
            halfH = designSize.height / 2;
        }

        const marginX = Math.min(halfW * 0.08, 48);
        const marginY = Math.min(halfH * 0.08, 48);
        const topY = halfH - marginY;
        const bottomY = -halfH + marginY;

        // 波次标签（左上角）
        this._waveLabel = this._createLabel('WaveLabel', new Color(255, 255, 255, 255), 0, 1);
        this._waveLabel.node.setPosition(-halfW + marginX, topY, 0);
        this._waveLabel.fontSize = 28;
        this._waveLabel.lineHeight = 32;
        this._waveLabel.horizontalAlign = Label.HorizontalAlign.LEFT;

        // 计时器标签（顶部居中）
        this._timerLabel = this._createLabel('TimerLabel', new Color(200, 220, 255, 255), 0.5, 1);
        this._timerLabel.node.setPosition(0, topY, 0);
        this._timerLabel.fontSize = 24;
        this._timerLabel.lineHeight = 28;

        // 击杀标签（右上角）
        this._killLabel = this._createLabel('KillLabel', new Color(255, 100, 100, 255), 1, 1);
        this._killLabel.node.setPosition(halfW - marginX, topY, 0);
        this._killLabel.fontSize = 24;
        this._killLabel.lineHeight = 28;
        this._killLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;

        // 修改器摘要（左下角）
        this._modifierLabel = this._createLabel('ModifierLabel', new Color(180, 255, 180, 255), 0, 0);
        this._modifierLabel.node.setPosition(-halfW + marginX, bottomY, 0);
        this._modifierLabel.fontSize = 18;
        this._modifierLabel.lineHeight = 22;
        this._modifierLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    }

    private _createLabel(name: string, color: Color, anchorX: number = 0.5, anchorY: number = 0.5): Label {
        const node = new Node(name);
        this.node.addChild(node);

        const ut = node.addComponent(UITransform);
        ut.setContentSize(300, 50);
        ut.anchorX = anchorX;
        ut.anchorY = anchorY;

        const label = node.addComponent(Label);
        label.color = color;
        label.string = '';
        return label;
    }

    // ────────────────────────────────
    //  事件处理
    // ────────────────────────────────

    private _onWaveStart(payload: { wave: number }): void {
        this._currentWave = payload.wave;
        this._updateWaveLabel();
    }

    private _onEnemyDied(): void {
        this._killCount++;
        this._updateKillLabel();
    }

    private _onGameStart(): void {
        this._gameTime = 0;
        this._killCount = 0;
        this._currentWave = 0;
        this._updateTimer();
        this._updateKillLabel();
        this._updateModifierLabel();
    }

    private _onRewardSelected(): void {
        this._updateModifierLabel();
    }

    // ────────────────────────────────
    //  文本更新
    // ────────────────────────────────

    private _updateWaveLabel(): void {
        if (!this._waveLabel) return;
        this._waveLabel.string = `第 ${this._currentWave} 波`;
    }

    private _updateTimer(): void {
        if (!this._timerLabel) return;
        const minutes = Math.floor(this._gameTime / 60);
        const seconds = Math.floor(this._gameTime % 60);
        const mm = minutes < 10 ? '0' + minutes : '' + minutes;
        const ss = seconds < 10 ? '0' + seconds : '' + seconds;
        this._timerLabel.string = `${mm}:${ss}`;
    }

    private _updateKillLabel(): void {
        if (!this._killLabel) return;
        this._killLabel.string = `击杀: ${this._killCount}`;
    }

    private _updateModifierLabel(): void {
        if (!this._modifierLabel) return;
        const stats = RoguelikeRewardSystem.getTotalStats();
        const lines: string[] = [];
        if (stats.damageMul !== 1.0) lines.push(`伤害 x${stats.damageMul.toFixed(2)}`);
        if (stats.fireRateMul !== 1.0) lines.push(`攻速 x${(1 / stats.fireRateMul).toFixed(2)}`);
        if (stats.bulletSpeedMul !== 1.0) lines.push(`弹速 x${stats.bulletSpeedMul.toFixed(2)}`);
        if (stats.multishot > 0) lines.push(`散射 +${stats.multishot}`);
        this._modifierLabel.string = lines.length > 0 ? lines.join('\n') : '无修改器';
    }
}
