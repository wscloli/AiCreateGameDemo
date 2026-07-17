/**
 * GameLoop.ts
 *
 * 战斗场景中【唯一的 update 发动机】
 */

import { _decorator, Component, find, Vec3, Node, Canvas } from 'cc';
import { PoolManager } from './PoolManager';
import { GameManager, GameState } from './GameManager';
import { PlayerController } from '../Player/PlayerController';
import { WeaponSystem } from '../Player/WeaponSystem';
import { EventBus } from './EventBus';
import { VFXManager } from './VFXManager';
import { EnvironmentManager } from './EnvironmentManager';
import { BaseBullet } from '../Bullets/BaseBullet';
import { BasicBullet } from '../Bullets/BasicBullet';
import { OilBullet } from '../Bullets/OilBullet';
import { FireBullet } from '../Bullets/FireBullet';
import { LightningBullet } from '../Bullets/LightningBullet';
import { WaterBullet } from '../Bullets/WaterBullet';
import { EnemyManager } from '../Enemy/EnemyManager';
import { EnemyStatusComponent } from '../Enemy/EnemyStatusComponent';

const { ccclass, property } = _decorator;

const BULLET_CLASSES: (new () => BaseBullet)[] = [BasicBullet, OilBullet, FireBullet, LightningBullet, WaterBullet];

export interface FrameDebugInfo {
    bulletCount: number;
    enemyCount: number;
    dt: number;
}

@ccclass('GameLoop')
export class GameLoop extends Component {
    @property
    public playerNodePath: string = '';

    @property
    public enableDebugLog: boolean = false;

    @property
    public debugLogInterval: number = 60;

    /** 相机跟随平滑速度（0=瞬间，越大越平滑） */
    @property
    public cameraFollowSpeed: number = 5.0;

    private _frameCount: number = 0;
    private _playerController: PlayerController | null = null;
    private _weaponSystem: WeaponSystem | null = null;
    private _gameManager: GameManager | null = null;
    private _isRunning: boolean = false;
    private _isPaused: boolean = false;
    private _playerResolved: boolean = false;
    private _vfxManager: VFXManager | null = null;
    private _cameraNode: Node | null = null;

    private _debugInfo: FrameDebugInfo = { bulletCount: 0, enemyCount: 0, dt: 0 };

    protected onLoad(): void {
        this._gameManager = this.node.getComponent(GameManager);
        EventBus.on('QUERY_PLAYER_POSITION', this._onQueryPlayerPosition, this);
        EventBus.on('GAME_PAUSE', this._onGamePause, this);
        EventBus.on('GAME_RESUME', this._onGameResume, this);
    }

    protected onDestroy(): void {
        EventBus.off('QUERY_PLAYER_POSITION', this._onQueryPlayerPosition, this);
        EventBus.off('GAME_PAUSE', this._onGamePause, this);
        EventBus.off('GAME_RESUME', this._onGameResume, this);
    }

    private _onQueryPlayerPosition(callback: (pos: Vec3) => void): void {
        if (this._playerController) {
            callback(this._playerController.node.position);
        }
    }

    private _onGamePause(): void {
        this._isPaused = true;
        console.log('[GameLoop] 游戏暂停');
    }

    private _onGameResume(): void {
        this._isPaused = false;
        console.log('[GameLoop] 游戏恢复');
    }

    protected update(dt: number): void {
        if (!this._isRunning) return;

        // 延迟解析玩家节点
        if (!this._playerResolved) {
            let playerNode: Node | null = null;
            if (this.playerNodePath) {
                playerNode = find(this.playerNodePath);
            } else {
                const allPlayerControllers = this.node.scene?.getComponentsInChildren(PlayerController);
                if (allPlayerControllers && allPlayerControllers.length > 0) {
                    this._playerController = allPlayerControllers[0];
                    playerNode = this._playerController.node;
                }
            }
            if (playerNode) {
                if (!this._playerController) {
                    this._playerController = playerNode.getComponent(PlayerController);
                }
                this._weaponSystem = playerNode.getComponent(WeaponSystem);
                this._playerResolved = true;
                console.log('[GameLoop] 玩家节点已就绪: ' + playerNode.name);
            }
        }

        const safeDt = Math.min(dt, 0.05);
        this._frameCount++;
        this._debugInfo.dt = safeDt;

        // 暂停时只更新视觉特效和环境区域，冻结战斗逻辑
        if (!this._isPaused) {
            // P1: 玩家 + 武器系统
            this._playerController?.tick(safeDt);
            this._weaponSystem?.tick(safeDt);

            // P1.5: 相机跟随玩家（土豆兄弟式：移动 Camera 节点）
            this._tickCamera(safeDt);

            // P2: 敌人移动（先移动，让子弹看到最新位置）
            const enemies = PoolManager.getActiveList(EnemyStatusComponent);
            for (let i = enemies.length - 1; i >= 0; i--) {
                enemies[i].tick(safeDt);
            }

            // P3: 重建四叉树（用敌人最新位置）
            EnemyManager.tick(safeDt);
            this._debugInfo.enemyCount = EnemyManager.aliveCount;

            // P4: 子弹（移动 + 碰撞检测，查的是刚重建的四叉树）
            let totalBullets = 0;
            for (const bulletClass of BULLET_CLASSES) {
                const bullets = PoolManager.getActiveList(bulletClass);
                totalBullets += bullets.length;
                for (let i = bullets.length - 1; i >= 0; i--) {
                    bullets[i].tick(safeDt);
                }
            }
            this._debugInfo.bulletCount = totalBullets;

            // P5: 波次
            this._gameManager?.tick(safeDt);
        }

        // P6: 视觉特效（始终更新，让暂停时特效不卡顿）
        if (!this._vfxManager) {
            const canvas = this.node.scene?.getChildByName('Canvas');
            if (canvas) {
                this._vfxManager = canvas.getComponent(VFXManager);
            }
        }
        this._vfxManager?.tick(safeDt);

        // P7: 环境区域衰减（始终更新）
        EnvironmentManager.tick(safeDt);

        if (this.enableDebugLog && this._frameCount % this.debugLogInterval === 0) {
            console.log(
                '[GameLoop] 帧#' + this._frameCount +
                ' 子弹:' + this._debugInfo.bulletCount +
                ' 敌人:' + this._debugInfo.enemyCount +
                ' dt:' + (safeDt * 1000).toFixed(1) + 'ms'
            );
        }
    }

    public startLoop(): void {
        this._isRunning = true;
        this._frameCount = 0;
        console.log('[GameLoop] 主循环启动');
    }

    public stopLoop(): void {
        this._isRunning = false;
        console.log('[GameLoop] 主循环停止');
    }

    public reset(): void {
        this._isRunning = false;
        this._frameCount = 0;
        this._playerResolved = false;
        this._playerController = null;
        this._weaponSystem = null;
    }

    public getDebugInfo(): FrameDebugInfo {
        return { ...this._debugInfo };
    }

    /** 相机跟随玩家：将 Camera 节点的局部坐标平滑插值到玩家位置 */
    private _tickCamera(dt: number): void {
        if (!this._playerController) return;

        // 懒加载相机节点
        if (!this._cameraNode) {
            const canvas = this.node.scene?.getChildByName('Canvas');
            if (canvas) {
                const canvasComp = canvas.getComponent(Canvas) as Canvas;
                if (canvasComp?.cameraComponent) {
                    this._cameraNode = canvasComp.cameraComponent.node;
                }
            }
        }
        if (!this._cameraNode) return;

        const playerPos = this._playerController.node.position;
        const camPos = this._cameraNode.position;

        // 平滑插值：speed 越大越跟手
        const t = 1 - Math.exp(-this.cameraFollowSpeed * dt);
        const targetX = camPos.x + (playerPos.x - camPos.x) * t;
        const targetY = camPos.y + (playerPos.y - camPos.y) * t;

        this._cameraNode.setPosition(targetX, targetY, camPos.z);
    }
}

