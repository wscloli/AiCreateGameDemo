/**
 * GameManager.ts
 *
 * 全局生命周期总控（场景单例）
 *
 * 职责：
 * - 按顺序初始化所有核心系统
 * - 维护游戏状态机（LOADING → PLAYING → GAMEOVER）
 * - 控制 GameLoop 的启动/停止
 * - 波次调度入口
 *
 * 初始化时序：
 * - onLoad: 注册单例、波次配置、事件监听（此时其他组件可能未就绪）
 * - start:  初始化所有核心系统（此时所有组件的 onLoad 已执行完毕）
 */

import { _decorator, Component, Vec3, director } from 'cc';
import { ElementType } from './ElementReactionHub';
import { EventBus } from './EventBus';
import { PoolManager } from './PoolManager';
import { Quadtree } from './Quadtree';
import { ElementReactionHub } from './ElementReactionHub';
import { GameLoop } from './GameLoop';
import { EnemyManager } from '../Enemy/EnemyManager';
import { ReactionProcessor } from '../Enemy/ReactionProcessor';
import { BulletFactory } from '../Player/BulletFactory';
import { RoguelikeRewardSystem } from '../Player/RoguelikeRewardSystem';

const { ccclass, property } = _decorator;

export enum GameState {
    LOADING = 'LOADING',
    PLAYING = 'PLAYING',
    GAMEOVER = 'GAMEOVER',
}

interface WaveConfig {
    waveId: number;
    enemyCount: number;
    enemyHp: number;
    enemySpeed: number;
    spawnInterval: number;
    spawnRadius: number;
}

@ccclass('GameManager')
export class GameManager extends Component {
    private static _instance: GameManager | null = null;

    public static get instance(): GameManager {
        if (!GameManager._instance) {
            throw new Error('[GameManager] 尚未初始化');
        }
        return GameManager._instance;
    }

    @property
    public worldWidth: number = 1200;

    @property
    public worldHeight: number = 800;

    @property
    public quadtreeMaxEntities: number = 8;

    @property
    public quadtreeMaxDepth: number = 8;

    private _waveConfigs: WaveConfig[] = [];
    private _gameState: GameState = GameState.LOADING;
    private _currentWave: number = 0;
    private _waveSpawned: number = 0;
    private _waveTimer: number = 0;
    private _quadtree: Quadtree | null = null;
    private _gameTime: number = 0;
    private _gameLoop: GameLoop | null = null;
    private _systemsInitialized: boolean = false;

    private _nextWavePending: boolean = false;
    private _nextWaveDelay: number = 0;

    // ────────────────────────────────
    //  生命周期
    // ────────────────────────────────

    protected onLoad(): void {
        if (GameManager._instance) {
            this.node.destroy();
            return;
        }
        GameManager._instance = this;
        director.addPersistRootNode(this.node);

        // onLoad 阶段：只做零依赖的准备工作
        this._gameLoop = this.node.getComponent(GameLoop);
        this._initWaveConfigs();
        this._registerEvents();

        console.log('[GameManager] 已注册，等待 start 阶段初始化系统...');
    }

    /**
     * start 阶段：所有组件的 onLoad 已执行完毕，
     * PoolManager._instance 已就绪，可以安全初始化系统。
     */
    protected start(): void {
        this._initAllSystems();
        console.log('[GameManager] 初始化完成，自动启动游戏');
        this.scheduleOnce(() => {
            if (this._gameState === GameState.LOADING) {
                this.startGame();
            }
        }, 0.1);
    }

    protected onDestroy(): void {
        this._unregisterEvents();
        if (GameManager._instance === this) {
            GameManager._instance = null;
        }
    }

    // ────────────────────────────────
    //  GameLoop 驱动接口
    // ────────────────────────────────

    public tick(dt: number): void {
        if (this._gameState !== GameState.PLAYING) return;

        this._gameTime += dt;
        this._tickWaveSpawning(dt);
        this._checkWaveComplete();

        // 下一波延迟（受暂停影响，因为在 tick 外）
        if (this._nextWavePending) {
            this._nextWaveDelay -= dt;
            if (this._nextWaveDelay <= 0) {
                this._nextWavePending = false;
                this.startWave(this._currentWave + 1);
            }
        }
    }

    // ────────────────────────────────
    //  系统初始化
    // ────────────────────────────────

    private _initAllSystems(): void {
        if (this._systemsInitialized) return;
        this._systemsInitialized = true;

        console.log('[GameManager] 开始初始化核心系统...');

        ElementReactionHub.init();
        console.log('  ✓ ElementReactionHub: ' + ElementReactionHub.getRegisteredReactions().join(', '));

        this._quadtree = new Quadtree(this.worldWidth, this.worldHeight, this.quadtreeMaxEntities, this.quadtreeMaxDepth);
        console.log('  ✓ Quadtree (' + this.worldWidth + 'x' + this.worldHeight + ')');

        // PoolManager 已在 onLoad 阶段由 Cocos 自动挂载，instance 已就绪
        if (!this.node.getComponent(PoolManager)) {
            this.node.addComponent(PoolManager);
        }
        console.log('  ✓ PoolManager');

        BulletFactory.init(this._quadtree);
        console.log('  ✓ BulletFactory');

        EnemyManager.init(this._quadtree);
        if (!this.node.getComponent(EnemyManager)) {
            this.node.addComponent(EnemyManager);
        }
        console.log('  ✓ EnemyManager');

        if (!this.node.getComponent(ReactionProcessor)) {
            this.node.addComponent(ReactionProcessor);
        }
        console.log('  ✓ ReactionProcessor');

        if (!this.node.getComponent(RoguelikeRewardSystem)) {
            this.node.addComponent(RoguelikeRewardSystem);
        }
        console.log('  ✓ RoguelikeRewardSystem');

        console.log('[GameManager] 所有核心系统初始化完成');
    }

    private _initWaveConfigs(): void {
        for (let i = 1; i <= 20; i++) {
            this._waveConfigs.push({
                waveId: i,
                enemyCount: 5 + i * 3,
                enemyHp: 30 + i * 10,
                enemySpeed: 50 + i * 5,
                spawnInterval: Math.max(0.3, 1.0 - i * 0.03),
                spawnRadius: 400 + i * 10,
            });
        }
    }

    private _registerEvents(): void {
        EventBus.on('QUERY_ENEMY_POSITIONS', this._onQueryEnemyPositions, this);
        EventBus.on('ENEMY_DIED', this._onEnemyDied, this);
        EventBus.on('PLAYER_DEATH', this._onPlayerDeath, this);
        EventBus.on('REWARD_SELECTED', this._onRewardSelected, this);
    }

    private _unregisterEvents(): void {
        EventBus.off('QUERY_ENEMY_POSITIONS', this._onQueryEnemyPositions, this);
        EventBus.off('ENEMY_DIED', this._onEnemyDied, this);
        EventBus.off('PLAYER_DEATH', this._onPlayerDeath, this);
        EventBus.off('REWARD_SELECTED', this._onRewardSelected, this);
    }

    // ────────────────────────────────
    //  公开接口
    // ────────────────────────────────

    public startGame(): void {
        if (this._gameState === GameState.PLAYING) {
            console.warn('[GameManager] 游戏已在运行中');
            return;
        }
        this._gameState = GameState.PLAYING;
        this._gameTime = 0;
        this._currentWave = 0;

        this._gameLoop?.startLoop();

        EventBus.emit('GAME_START', { timestamp: Date.now() });
        console.log('[GameManager] 游戏开始');

        // 开局先弹出初始奖励选择（wave=0，稀有度概率更低）
        RoguelikeRewardSystem.onWaveComplete({ wave: 0 });
    }

    public startWave(waveId: number): void {
        if (waveId > this._waveConfigs.length) {
            console.log('[GameManager] 所有波次已完成！');
            this._onGameWin();
            return;
        }

        this._currentWave = waveId;
        this._waveSpawned = 0;
        this._waveTimer = 0;

        EventBus.emit('WAVE_START', { wave: waveId });
        console.log('[GameManager] 第 ' + waveId + ' 波启动');
    }

    public get gameState(): GameState { return this._gameState; }
    public get currentWave(): number { return this._currentWave; }
    public get gameTime(): number { return this._gameTime; }
    public get quadtree(): Quadtree | null { return this._quadtree; }

    // ────────────────────────────────
    //  波次生成
    // ────────────────────────────────

    private _tickWaveSpawning(dt: number): void {
        const config = this._waveConfigs[this._currentWave - 1];
        if (!config || this._waveSpawned >= config.enemyCount) return;

        this._waveTimer += dt;

        while (this._waveTimer >= config.spawnInterval && this._waveSpawned < config.enemyCount) {
            this._waveTimer -= config.spawnInterval;
            this._waveSpawned++;

            const angle = Math.random() * Math.PI * 2;
            const radius = config.spawnRadius + (Math.random() - 0.5) * 100;

            const enemyConfig = this._buildEnemyConfig(this._currentWave, this._waveSpawned, config.enemyCount);
            EnemyManager.spawnEnemy(
                enemyConfig,
                new Vec3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
            );
        }
    }

    /**
     * 根据波次和索引构建敌人配置（混合敌人类型）
     */
    private _buildEnemyConfig(waveNumber: number, index: number, total: number): { maxHp: number; moveSpeed: number; enemyType?: string; elementResist?: ElementType[] } {
        const baseHp = 30 + waveNumber * 10;
        const baseSpeed = 50 + waveNumber * 5;

        // 第 1 波：全普通怪
        if (waveNumber === 1) {
            return { maxHp: baseHp, moveSpeed: baseSpeed, enemyType: 'GRUNT' };
        }

        const r = Math.random();

        // 坦克怪：第 3 波起，低概率
        if (waveNumber >= 3 && r < 0.15) {
            return {
                maxHp: Math.floor(baseHp * 2.5),
                moveSpeed: Math.floor(baseSpeed * 0.4),
                enemyType: 'TANK',
                elementResist: [ElementType.FIRE, ElementType.OIL],
            };
        }

        // 冲锋怪：第 2 波起，中等概率
        if (waveNumber >= 2 && r < 0.35) {
            return {
                maxHp: baseHp,
                moveSpeed: Math.floor(baseSpeed * 1.3),
                enemyType: 'CHARGER',
            };
        }

        // 迂回怪：第 4 波起，中等概率
        if (waveNumber >= 4 && r < 0.55) {
            return {
                maxHp: Math.floor(baseHp * 0.8),
                moveSpeed: Math.floor(baseSpeed * 1.1),
                enemyType: 'FLANKER',
            };
        }

        return { maxHp: baseHp, moveSpeed: baseSpeed, enemyType: 'GRUNT' };
    }

    private _checkWaveComplete(): void {
        const config = this._waveConfigs[this._currentWave - 1];
        if (!config) return;

        if (this._waveSpawned >= config.enemyCount && EnemyManager.aliveCount === 0 && !this._nextWavePending) {
            console.log('[GameManager] 第 ' + this._currentWave + ' 波完成！');
            EventBus.emit('WAVE_COMPLETE', { wave: this._currentWave });

            // 延迟 2s 启动下一波，使用受 GameLoop 暂停控制的计时器
            this._nextWavePending = true;
            this._nextWaveDelay = 2.0;
        }
    }

    // ────────────────────────────────
    //  事件处理
    // ────────────────────────────────
    //  奖励选择
    // ────────────────────────────────

    private _onRewardSelected(_payload: { modifier: any }): void {
        if (this._currentWave === 0) {
            // 初始奖励选择完成后，正式启动第 1 波
            this.startWave(1);
        }
    }

    // ────────────────────────────────

    private _onQueryEnemyPositions(callback: (enemies: { x: number; y: number }[]) => void): void {
        const enemies = EnemyManager.getAllEnemies();
        const positions: { x: number; y: number }[] = [];
        for (const [, component] of enemies) {
            positions.push(component.position);
        }
        callback(positions);
    }

    private _onEnemyDied(_payload: { enemyId: string; position: { x: number; y: number } }): void {
        // 预留
    }

    // ────────────────────────────────
    //  游戏结束
    // ────────────────────────────────

    private _onGameWin(): void {
        this._gameState = GameState.GAMEOVER;
        this._gameLoop?.stopLoop();
        EventBus.emit('GAME_WIN', { gameTime: this._gameTime, wavesCompleted: this._currentWave });
        console.log('[GameManager] 通关！用时 ' + this._gameTime.toFixed(1) + 's');
    }

    public onPlayerDeath(): void {
        if (this._gameState !== GameState.PLAYING) return;
        this._gameState = GameState.GAMEOVER;
        this._gameLoop?.stopLoop();
        EventBus.emit('GAME_OVER', { gameTime: this._gameTime, wave: this._currentWave });
        console.log('[GameManager] 游戏结束，存活至第 ' + this._currentWave + ' 波');
    }

    private _onPlayerDeath(): void {
        this.onPlayerDeath();
    }

    public restartGame(): void {
        this._gameLoop?.stopLoop();
        EnemyManager.despawnAll();
        PoolManager.clearAll();
        ElementReactionHub.reset();
        ElementReactionHub.init();
        RoguelikeRewardSystem.reset();

        this._nextWavePending = false;
        this._nextWaveDelay = 0;

        this._quadtree = new Quadtree(this.worldWidth, this.worldHeight, this.quadtreeMaxEntities, this.quadtreeMaxDepth);
        BulletFactory.init(this._quadtree);
        EnemyManager.init(this._quadtree);
        this._gameLoop?.reset();
        this.startGame();
    }
}
