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
import { PlayerController } from '../Player/PlayerController';
import { WeaponSystem } from '../Player/WeaponSystem';
import { EnemyManager } from '../Enemy/EnemyManager';
import { EventBus } from './EventBus';

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

        // 5. 怪物视觉
        EventBus.on('ENEMY_SPAWNED', (p: { enemyId: string; position: { x: number; y: number } }) => {
            const enemies = EnemyManager.getAllEnemies();
            const e = enemies.get(p.enemyId);
            if (!e) return;
            const c = scene.getChildByName('Canvas');
            if (c) e.node.parent = c;
            if (!e.node.getComponent(UITransform)) {
                const ut = e.node.addComponent(UITransform);
                ut.setContentSize(64, 64);
            }
            let sp = e.node.getComponent(Sprite);
            if (!sp) {
                sp = e.node.addComponent(Sprite);
            }
            sp.spriteFrame = this._redSf;
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.trim = false;
            e.node.setPosition(new Vec3(p.position.x, p.position.y, 0));
        });

        // 6. 启动
        this.scheduleOnce(() => {
            try { GameManager.instance.startGame(); } catch (e) {
                console.error('[BattleTestScaffold] 启动失败:', e);
            }
        }, 0.5);

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
