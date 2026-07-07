/**
 * BattleTestScaffold.ts
 *
 * 场景运行首测脚手架
 *
 * 核心策略：
 * - Canvas.start() 会在运行时覆盖相机设置
 * - 我们的 start() 在 Canvas.start() 之后执行，可以修复
 * - 所有游戏节点挂在 Canvas 下（Graphics 需要）
 * - 修复 Canvas 相机：SOLID_COLOR + 所有层可见
 */

import { _decorator, Component, Node, Sprite, SpriteFrame, Texture2D, Color, director, Vec3, Canvas, UITransform } from 'cc';
import { GameManager } from './GameManager';
import { GameLoop } from './GameLoop';
import { VFXManager } from './VFXManager';
import { EnvironmentManager, ZoneType } from './EnvironmentManager';
import { PlayerController } from '../Player/PlayerController';
import { WeaponSystem } from '../Player/WeaponSystem';
import { EnemyManager } from '../Enemy/EnemyManager';
import { EventBus } from './EventBus';
import { PoolManager } from './PoolManager';
import { EntityVisualFactory } from './EntityVisualFactory';
import { OilBullet } from '../Bullets/OilBullet';
import { FireBullet } from '../Bullets/FireBullet';
import { LightningBullet } from '../Bullets/LightningBullet';
import { WaterBullet } from '../Bullets/WaterBullet';
import { EnemyStatusComponent } from '../Enemy/EnemyStatusComponent';
import { BattleHUD } from '../UI/BattleHUD';
import { GameOverPanel } from '../UI/GameOverPanel';
import { RewardSelectionPanel } from '../UI/RewardSelectionPanel';

const { ccclass } = _decorator;

@ccclass('BattleTestScaffold')
export class BattleTestScaffold extends Component {
    private _assembled = false;

    protected start(): void {
        if (this._assembled) return;
        this._assembled = true;
        console.log('[BattleTestScaffold] 开始自动总装...');
        this._assemble();
    }

    private _whiteSf: SpriteFrame | null = null;
    private _redSf: SpriteFrame | null = null;

    private _assemble(): void {
        const scene = director.getScene()!;
        const canvas = scene.getChildByName('Canvas');
        if (!canvas) {
            console.error('[BattleTestScaffold] 无 Canvas 节点');
            return;
        }

        // 1. 修复 Canvas 相机（Canvas.start() 已执行完毕）
        this._fixCamera(canvas);

        // 挂载 VFXManager
        if (!canvas.getComponent(VFXManager)) {
            canvas.addComponent(VFXManager);
        }

        // 挂载 EnvironmentManager
        if (!canvas.getComponent(EnvironmentManager)) {
            canvas.addComponent(EnvironmentManager);
        }

        // 挂载 UI 系统
        this._mountUI(canvas);

        // 预创建纯色纹理（跨原生/浏览器兼容）
        this._whiteSf = this._createColorSpriteFrame(255, 255, 255, 255);
        this._redSf = this._createColorSpriteFrame(220, 50, 50, 255);

        // 2. 把 GameRoot 移到 Canvas 下，确保所有节点被 UI 相机渲染
        const gameRoot = scene.getChildByName('GameRoot');
        if (gameRoot && gameRoot.parent !== canvas) {
            gameRoot.parent = canvas;
        }

        let root = canvas.getChildByName('BattleRoot');
        if (!root) {
            root = new Node('BattleRoot');
            canvas.addChild(root);
        }

        // 3. 创建 Player
        const playerNode = new Node('Player');
        root.addChild(playerNode);
        playerNode.setPosition(new Vec3(0, -200, 0));

        const playerUt = playerNode.addComponent(UITransform);
        playerUt.setContentSize(64, 64);

        const playerSp = playerNode.addComponent(Sprite);
        playerSp.spriteFrame = this._whiteSf;
        playerSp.sizeMode = Sprite.SizeMode.CUSTOM;
        playerSp.trim = false;

        const controller = playerNode.addComponent(PlayerController);
        controller.moveSmoothing = 0.0; // 0=瞬间跟手，>0=平滑插值

        const weapon = playerNode.addComponent(WeaponSystem);
        weapon.baseFireInterval = 0.5;
        weapon.baseDamage = 10;
        weapon.baseSpeed = 350;
        weapon.bulletLifetime = 3.0;

        // 4. 设置 GameLoop
        if (gameRoot) {
            const gl = gameRoot.getComponent(GameLoop);
            if (gl) {
                gl.playerNodePath = 'Canvas/BattleRoot/Player';
                gl.enableDebugLog = true;
            }
        }

        // 5. 敌人视觉由模板节点自带，只需确保 parent 正确
        EventBus.on('ENEMY_SPAWNED', (p: { enemyId: string; position: { x: number; y: number } }) => {
            const enemies = EnemyManager.getAllEnemies();
            const e = enemies.get(p.enemyId);
            if (!e) return;
            const c = scene.getChildByName('Canvas');
            if (c && e.node.parent !== c) e.node.parent = c;
            e.node.setPosition(new Vec3(p.position.x, p.position.y, 0));
        });

        // 6. 注册运行时模板节点（延迟 0.1s 确保 GameManager._initAllSystems 已执行）
        this.scheduleOnce(() => {
            this._registerVisualTemplates();
        }, 0.1);

        // 7. 启动
        this.scheduleOnce(() => {
            try { GameManager.instance.startGame(); } catch (e) {
                console.error('[BattleTestScaffold] 启动失败:', e);
            }
        }, 0.5);

        // 8. 测试环境区域（油洼 + 积水）
        this.scheduleOnce(() => {
            EnvironmentManager.spawnZone(ZoneType.OIL_PUDDLE, { x: -150, y: 100 }, 100, 30);
            EnvironmentManager.spawnZone(ZoneType.WATER_POOL, { x: 150, y: -100 }, 100, 30);
            console.log('[BattleTestScaffold] 已生成测试环境区域');
        }, 1.0);

        console.log('[BattleTestScaffold] 总装完成');
    }

    /**
     * 创建纯色 SpriteFrame（原生/浏览器通用）
     */
    private _createColorSpriteFrame(r: number, g: number, b: number, a: number): SpriteFrame {
        const size = 64;
        const texture = new Texture2D();
        texture.reset({
            width: size,
            height: size,
            format: Texture2D.PixelFormat.RGBA8888,
        });

        const pixelCount = size * size * 4;
        const data = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i += 4) {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = a;
        }
        texture.uploadData(data);

        const spriteFrame = new SpriteFrame();
        spriteFrame.texture = texture;
        spriteFrame.rect.width = size;
        spriteFrame.rect.height = size;
        spriteFrame.originalSize.width = size;
        spriteFrame.originalSize.height = size;
        spriteFrame.offset.x = 0;
        spriteFrame.offset.y = 0;

        return spriteFrame;
    }

    /**
     * 为 PoolManager 中已注册的对象池注入运行时视觉模板节点
     */
    private _registerVisualTemplates(): void {
        // 子弹模板
        PoolManager.setTemplateNode(OilBullet, EntityVisualFactory.createTemplateNode({
            name: 'OilBulletTemplate',
            size: { width: 24, height: 24 },
            color: { r: 120, g: 80, b: 40, a: 255 },
            outline: { r: 80, g: 50, b: 20, a: 255 },
        }));

        PoolManager.setTemplateNode(FireBullet, EntityVisualFactory.createTemplateNode({
            name: 'FireBulletTemplate',
            size: { width: 16, height: 16 },
            color: { r: 255, g: 100, b: 30, a: 255 },
            outline: { r: 200, g: 60, b: 10, a: 255 },
        }));

        PoolManager.setTemplateNode(LightningBullet, EntityVisualFactory.createTemplateNode({
            name: 'LightningBulletTemplate',
            size: { width: 12, height: 12 },
            color: { r: 200, g: 220, b: 255, a: 255 },
            outline: { r: 150, g: 180, b: 255, a: 255 },
        }));

        PoolManager.setTemplateNode(WaterBullet, EntityVisualFactory.createTemplateNode({
            name: 'WaterBulletTemplate',
            size: { width: 20, height: 20 },
            color: { r: 60, g: 140, b: 220, a: 255 },
            outline: { r: 30, g: 100, b: 180, a: 255 },
        }));

        // 敌人模板
        PoolManager.setTemplateNode(EnemyStatusComponent, EntityVisualFactory.createTemplateNode({
            name: 'EnemyTemplate',
            size: { width: 64, height: 64 },
            color: { r: 220, g: 50, b: 50, a: 255 },
            outline: { r: 160, g: 30, b: 30, a: 255 },
        }));

        // 模板注册完毕后，手动 prewarm
        PoolManager.prewarm(OilBullet, 20);
        PoolManager.prewarm(FireBullet, 20);
        PoolManager.prewarm(LightningBullet, 20);
        PoolManager.prewarm(WaterBullet, 20);
        PoolManager.prewarm(EnemyStatusComponent, 30);

        console.log('[BattleTestScaffold] 已注册 5 种运行时视觉模板并完成 prewarm');
    }

    private _mountUI(canvas: Node): void {
        // HUD（始终显示）
        const hudNode = new Node('BattleHUD');
        canvas.addChild(hudNode);
        hudNode.addComponent(BattleHUD);

        // 游戏结束面板（默认隐藏）
        const gameOverNode = new Node('GameOverPanel');
        canvas.addChild(gameOverNode);
        gameOverNode.addComponent(GameOverPanel);

        // 奖励选择面板（默认隐藏）
        const rewardNode = new Node('RewardSelectionPanel');
        canvas.addChild(rewardNode);
        rewardNode.addComponent(RewardSelectionPanel);

        console.log('[BattleTestScaffold] UI 系统已挂载');
    }

    private _fixCamera(canvas: Node): void {
        const canvasComp = canvas.getComponent(Canvas);
        if (!canvasComp) return;
        const cam = canvasComp.cameraComponent;
        if (!cam) return;

        // Canvas.start() 已运行，修复被覆盖的设置
        cam.clearFlags = 7;           // COLOR | DEPTH | STENCIL — 真正清除屏幕
        cam.clearColor = new Color(26, 26, 46, 255); // 深色背景
        cam.visibility = 0x7FFFFFFF;  // 所有层
        cam.projection = 1;           // ORTHO
        cam.orthoHeight = 400;
        cam.near = 1;
        cam.far = 2000;

        console.log('[BattleTestScaffold] Canvas 相机已修复: clearFlags=COLOR|DEPTH|STENCIL, visibility=ALL');
    }
}
