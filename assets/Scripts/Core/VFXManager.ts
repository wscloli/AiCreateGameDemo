/**
 * VFXManager.ts
 *
 * 纯视觉特效系统
 *
 * 职责：
 * - 监听 EventBus 上所有 VFX_* 事件
 * - 使用 Graphics 绘制临时特效（爆炸/雷击/命中闪光等）
 * - 不挂载 Cocos update，由 GameLoop 调用 tick(dt)
 * - 特效节点自动回收，避免内存泄漏
 */

import { _decorator, Component, Node, Graphics, Color, Vec3 } from 'cc';
import { EventBus } from './EventBus';

const { ccclass } = _decorator;

interface VFXInstance {
    node: Node;
    graphics: Graphics;
    timer: number;
    maxTimer: number;
    type: string;
    data: any;
}

@ccclass('VFXManager')
export class VFXManager extends Component {
    private _vfxList: VFXInstance[] = [];
    private _canvas: Node | null = null;

    protected onLoad(): void {
        EventBus.on('VFX_EXPLOSION', this._onExplosion, this);
        EventBus.on('VFX_LIGHTNING_STRIKE', this._onLightningStrike, this);
        EventBus.on('VFX_LIGHTNING_CHAIN', this._onLightningChain, this);
        EventBus.on('VFX_FIRE_IMPACT', this._onHitImpact, this);
        EventBus.on('VFX_OIL_SPLASH', this._onHitImpact, this);
        EventBus.on('VFX_WATER_SPLASH', this._onHitImpact, this);
        EventBus.on('VFX_HIT_IMPACT', this._onHitImpact, this);
        EventBus.on('VFX_MAGNETIC_PULL', this._onMagneticPull, this);
        EventBus.on('VFX_PLAYER_HIT', this._onPlayerHit, this);
        EventBus.on('VFX_ENEMY_ATTACK', this._onEnemyAttack, this);
    }

    protected onDestroy(): void {
        EventBus.off('VFX_EXPLOSION', this._onExplosion, this);
        EventBus.off('VFX_LIGHTNING_STRIKE', this._onLightningStrike, this);
        EventBus.off('VFX_LIGHTNING_CHAIN', this._onLightningChain, this);
        EventBus.off('VFX_FIRE_IMPACT', this._onHitImpact, this);
        EventBus.off('VFX_OIL_SPLASH', this._onHitImpact, this);
        EventBus.off('VFX_WATER_SPLASH', this._onHitImpact, this);
        EventBus.off('VFX_HIT_IMPACT', this._onHitImpact, this);
        EventBus.off('VFX_MAGNETIC_PULL', this._onMagneticPull, this);
        EventBus.off('VFX_PLAYER_HIT', this._onPlayerHit, this);
        EventBus.off('VFX_ENEMY_ATTACK', this._onEnemyAttack, this);
    }

    /**
     * GameLoop 驱动接口
     */
    public tick(dt: number): void {
        for (let i = this._vfxList.length - 1; i >= 0; i--) {
            const vfx = this._vfxList[i];
            vfx.timer += dt;
            const progress = vfx.timer / vfx.maxTimer;

            if (progress >= 1) {
                this._recycleVFX(i);
                continue;
            }

            this._updateVFX(vfx, progress);
        }
    }

    // ────────────────────────────────
    //  事件处理
    // ────────────────────────────────

    private _onExplosion(payload: { position: { x: number; y: number }; radius: number }): void {
        this._spawnVFX('explosion', payload.position, 0.35, payload);
    }

    private _onLightningStrike(payload: { position: { x: number; y: number } }): void {
        this._spawnVFX('lightning_strike', payload.position, 0.15, payload);
    }

    private _onLightningChain(payload: { origin: { x: number; y: number }; targets: { x: number; y: number }[] }): void {
        this._spawnVFX('lightning_chain', payload.origin, 0.25, payload);
    }

    private _onHitImpact(payload: { position: { x: number; y: number } }): void {
        this._spawnVFX('hit_impact', payload.position, 0.2, payload);
    }

    private _onMagneticPull(payload: { position: { x: number; y: number }; radius: number }): void {
        this._spawnVFX('magnetic_pull', payload.position, 0.4, payload);
    }

    private _onPlayerHit(payload: { position: { x: number; y: number } }): void {
        this._spawnVFX('player_hit', payload.position, 0.25, payload);
    }

    private _onEnemyAttack(payload: { position: { x: number; y: number }; angle: number; radius: number }): void {
        this._spawnVFX('enemy_attack', payload.position, 0.3, payload);
    }

    // ────────────────────────────────
    //  内部方法
    // ────────────────────────────────

    private _getCanvas(): Node {
        if (!this._canvas || !this._canvas.isValid) {
            this._canvas = this.node.scene?.getChildByName('Canvas') || this.node;
        }
        return this._canvas;
    }

    private _spawnVFX(type: string, position: { x: number; y: number }, duration: number, data: any): void {
        const node = new Node('VFX_' + type);
        this._getCanvas().addChild(node);
        node.setPosition(new Vec3(position.x, position.y, 0));

        const g = node.addComponent(Graphics);
        this._vfxList.push({
            node,
            graphics: g,
            timer: 0,
            maxTimer: duration,
            type,
            data,
        });
    }

    private _updateVFX(vfx: VFXInstance, progress: number): void {
        const g = vfx.graphics;
        g.clear();

        switch (vfx.type) {
            case 'explosion': {
                const radius = 10 + progress * (vfx.data.radius || 150);
                const alpha = Math.floor((1 - progress) * 220);
                g.fillColor = new Color(255, 80, 10, alpha);
                g.circle(0, 0, radius);
                g.fill();
                // 内圈高亮
                g.fillColor = new Color(255, 200, 50, Math.floor(alpha * 0.6));
                g.circle(0, 0, radius * 0.5);
                g.fill();
                break;
            }

            case 'lightning_strike': {
                const alpha = Math.floor((1 - progress) * 255);
                g.fillColor = new Color(200, 240, 255, alpha);
                g.circle(0, 0, 16);
                g.fill();
                // 十字闪光
                g.strokeColor = new Color(255, 255, 255, alpha);
                g.lineWidth = 2;
                const len = 24 * (1 - progress * 0.5);
                g.moveTo(-len, 0);
                g.lineTo(len, 0);
                g.moveTo(0, -len);
                g.lineTo(0, len);
                g.stroke();
                break;
            }

            case 'lightning_chain': {
                const alpha = Math.floor((1 - progress) * 200);
                g.strokeColor = new Color(150, 220, 255, alpha);
                g.lineWidth = 2 + (1 - progress) * 2;
                const targets = vfx.data.targets || [];
                for (const t of targets) {
                    g.moveTo(0, 0);
                    g.lineTo(t.x - vfx.node.position.x, t.y - vfx.node.position.y);
                }
                g.stroke();
                // 节点闪光
                g.fillColor = new Color(200, 240, 255, alpha);
                for (const t of targets) {
                    g.circle(t.x - vfx.node.position.x, t.y - vfx.node.position.y, 6);
                    g.fill();
                }
                break;
            }

            case 'hit_impact': {
                const radius = progress * 18;
                const alpha = Math.floor((1 - progress) * 200);
                g.fillColor = new Color(255, 255, 255, alpha);
                g.circle(0, 0, radius);
                g.fill();
                break;
            }

            case 'magnetic_pull': {
                const radius = (vfx.data.radius || 250) * progress;
                const alpha = Math.floor((1 - progress) * 160);
                g.strokeColor = new Color(150, 50, 255, alpha);
                g.lineWidth = 2;
                g.circle(0, 0, radius);
                g.stroke();
                // 螺旋线
                g.strokeColor = new Color(200, 100, 255, alpha);
                const segments = 30;
                const maxR = radius * 0.8;
                for (let i = 0; i <= segments; i++) {
                    const angle = (i / segments) * Math.PI * 4 + progress * Math.PI * 2;
                    const r = (i / segments) * maxR;
                    const x = Math.cos(angle) * r;
                    const y = Math.sin(angle) * r;
                    if (i === 0) g.moveTo(x, y);
                    else g.lineTo(x, y);
                }
                g.stroke();
                break;
            }

            case 'player_hit': {
                // 玩家受击：红色扩散环 + 内部闪白
                const radius = progress * 24;
                const alpha = Math.floor((1 - progress) * 180);
                g.strokeColor = new Color(255, 60, 60, alpha);
                g.lineWidth = 3;
                g.circle(0, 0, radius);
                g.stroke();
                // 内圈
                g.fillColor = new Color(255, 100, 100, Math.floor(alpha * 0.4));
                g.circle(0, 0, radius * 0.5);
                g.fill();
                break;
            }

            case 'enemy_attack': {
                // 敌人近战攻击扇形圆弧：前半段淡色预警，后半段加深（伤害判定瞬间）
                const r = vfx.data.radius || 100;
                const angle = vfx.data.angle || 0;
                const spread = Math.PI / 3; // 60度扇形
                const startAngle = angle - spread / 2;
                const endAngle = angle + spread / 2;
                // 后半段(progress>0.5)加深颜色，模拟伤害判定瞬间
                const isHitFrame = progress > 0.5;
                const alpha = Math.floor((1 - progress) * (isHitFrame ? 255 : 160));
                const fillAlpha = Math.floor((1 - progress) * (isHitFrame ? 0.7 : 0.3) * 255);

                // 填充扇形
                g.fillColor = new Color(255, isHitFrame ? 40 : 80, 10, fillAlpha);
                g.moveTo(0, 0);
                const segments = 16;
                for (let i = 0; i <= segments; i++) {
                    const a = startAngle + (i / segments) * (endAngle - startAngle);
                    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                }
                g.lineTo(0, 0);
                g.fill();

                // 外圈弧线
                g.strokeColor = new Color(255, isHitFrame ? 100 : 200, 50, alpha);
                g.lineWidth = isHitFrame ? 4 : 2;
                g.moveTo(Math.cos(startAngle) * r, Math.sin(startAngle) * r);
                for (let i = 0; i <= segments; i++) {
                    const a = startAngle + (i / segments) * (endAngle - startAngle);
                    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                }
                g.stroke();

                // 两条边界线
                g.strokeColor = new Color(255, isHitFrame ? 80 : 160, 30, alpha);
                g.lineWidth = isHitFrame ? 3 : 1;
                g.moveTo(0, 0);
                g.lineTo(Math.cos(startAngle) * r, Math.sin(startAngle) * r);
                g.moveTo(0, 0);
                g.lineTo(Math.cos(endAngle) * r, Math.sin(endAngle) * r);
                g.stroke();

                // 伤害判定瞬间：中心闪烁十字
                if (isHitFrame) {
                    g.strokeColor = new Color(255, 255, 255, Math.floor((progress - 0.5) * 2 * 200));
                    g.lineWidth = 2;
                    const flashLen = 8;
                    g.moveTo(-flashLen, 0);
                    g.lineTo(flashLen, 0);
                    g.moveTo(0, -flashLen);
                    g.lineTo(0, flashLen);
                    g.stroke();
                }
                break;
            }
        }
    }

    private _recycleVFX(index: number): void {
        const vfx = this._vfxList[index];
        vfx.graphics.clear();
        vfx.node.removeFromParent();
        this._vfxList.splice(index, 1);
    }
}
