/**
 * EnemyAI.ts
 *
 * 敌人 AI 策略系统 —— 纯逻辑类，不继承 Cocos Component
 *
 * 所有策略暴露 update(enemy, dt, targetPos) 接口
 * 由 EnemyStatusComponent.tick() 调用
 */

import { Vec3 } from 'cc';
import { EnemyStatusComponent } from './EnemyStatusComponent';

export enum EnemyType {
    GRUNT = 'GRUNT',       // 普通怪：直线追踪
    CHARGER = 'CHARGER',   // 冲锋怪：周期性爆发冲刺
    FLANKER = 'FLANKER',   // 迂回怪：绕到玩家侧面
    TANK = 'TANK',         // 坦克怪：慢速 + 高 HP + 吸收盾
    RANGED = 'RANGED',     // 远程怪：保持距离 + 投射物（预留）
}

export interface IEnemyAI {
    /** 每帧更新，返回期望速度向量 {vx, vy}（像素/秒） */
    update(enemy: EnemyStatusComponent, dt: number, targetPos: { x: number; y: number }): { vx: number; vy: number };
}

// ────────────────────────────────
//  普通怪：直线追踪（当前默认行为）
// ────────────────────────────────

export class GruntAI implements IEnemyAI {
    public update(enemy: EnemyStatusComponent, _dt: number, targetPos: { x: number; y: number }): { vx: number; vy: number } {
        const pos = enemy.node.position;
        const dx = targetPos.x - pos.x;
        const dy = targetPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return { vx: 0, vy: 0 };
        return {
            vx: (dx / dist) * enemy.moveSpeed,
            vy: (dy / dist) * enemy.moveSpeed,
        };
    }
}

// ────────────────────────────────
//  冲锋怪：蓄力 → 冲刺 → 冷却 循环
// ────────────────────────────────

export class ChargerAI implements IEnemyAI {
    private _state: 'idle' | 'charge' | 'cooldown' = 'idle';
    private _timer: number = 0;

    // 配置参数（可外部化到 EnemyConfig）
    private static readonly CHARGE_PREPARE_TIME = 0.8;  // 蓄力时间（秒）
    private static readonly CHARGE_SPEED_MULT = 3.5;    // 冲刺速度倍率
    private static readonly CHARGE_DURATION = 0.4;      // 冲刺持续时间
    private static readonly COOLDOWN_DURATION = 1.5;    // 冷却时间
    private static readonly TRIGGER_DISTANCE = 250;     // 触发冲锋的距离阈值

    public update(enemy: EnemyStatusComponent, dt: number, targetPos: { x: number; y: number }): { vx: number; vy: number } {
        const pos = enemy.node.position;
        const dx = targetPos.x - pos.x;
        const dy = targetPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        switch (this._state) {
            case 'idle': {
                // 在触发距离内且角度对准时开始蓄力
                if (dist <= ChargerAI.TRIGGER_DISTANCE && dist > 1) {
                    this._state = 'charge';
                    this._timer = ChargerAI.CHARGE_PREPARE_TIME;
                    // 蓄力时减速，面向玩家
                    return {
                        vx: (dx / dist) * enemy.moveSpeed * 0.3,
                        vy: (dy / dist) * enemy.moveSpeed * 0.3,
                    };
                }
                // 普通追踪
                if (dist < 1) return { vx: 0, vy: 0 };
                return {
                    vx: (dx / dist) * enemy.moveSpeed,
                    vy: (dy / dist) * enemy.moveSpeed,
                };
            }

            case 'charge': {
                this._timer -= dt;
                if (this._timer <= 0) {
                    // 蓄力结束，开始冲刺
                    this._timer = ChargerAI.CHARGE_DURATION;
                    this._state = 'cooldown';
                }
                // 蓄力期间继续面向玩家但减速
                if (dist < 1) return { vx: 0, vy: 0 };
                return {
                    vx: (dx / dist) * enemy.moveSpeed * 0.3,
                    vy: (dy / dist) * enemy.moveSpeed * 0.3,
                };
            }

            case 'cooldown': {
                this._timer -= dt;
                if (this._timer <= 0) {
                    this._state = 'idle';
                }
                // 冲刺期间高速直线
                if (dist < 1) return { vx: 0, vy: 0 };
                return {
                    vx: (dx / dist) * enemy.moveSpeed * ChargerAI.CHARGE_SPEED_MULT,
                    vy: (dy / dist) * enemy.moveSpeed * ChargerAI.CHARGE_SPEED_MULT,
                };
            }
        }
    }
}

// ────────────────────────────────
//  迂回怪：不直接冲脸，绕到侧面
// ────────────────────────────────

export class FlankerAI implements IEnemyAI {
    private _orbitDirection: number = Math.random() > 0.5 ? 1 : -1; // 顺时针/逆时针

    // 配置参数
    private static readonly IDEAL_DISTANCE = 180;       // 理想距离
    private static readonly ORBIT_SPEED_MULT = 1.2;     // 环绕速度倍率
    private static readonly APPROACH_SPEED_MULT = 0.6;  // 接近/远离速度倍率

    public update(enemy: EnemyStatusComponent, _dt: number, targetPos: { x: number; y: number }): { vx: number; vy: number } {
        const pos = enemy.node.position;
        const dx = targetPos.x - pos.x;
        const dy = targetPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return { vx: 0, vy: 0 };

        // 朝向玩家的单位向量
        const toPlayerX = dx / dist;
        const toPlayerY = dy / dist;

        // 垂直向量（环绕方向）
        const orbitX = -toPlayerY * this._orbitDirection;
        const orbitY = toPlayerX * this._orbitDirection;

        // 径向速度：远离或接近以维持理想距离
        let radialSpeed = 0;
        const distDiff = dist - FlankerAI.IDEAL_DISTANCE;
        if (Math.abs(distDiff) > 20) {
            radialSpeed = (distDiff > 0 ? 1 : -1) * enemy.moveSpeed * FlankerAI.APPROACH_SPEED_MULT;
        }

        // 合成速度：径向 + 切向
        const vx = toPlayerX * radialSpeed + orbitX * enemy.moveSpeed * FlankerAI.ORBIT_SPEED_MULT;
        const vy = toPlayerY * radialSpeed + orbitY * enemy.moveSpeed * FlankerAI.ORBIT_SPEED_MULT;

        return { vx, vy };
    }
}

// ────────────────────────────────
//  坦克怪：慢速 + 高 HP，直线追踪
// ────────────────────────────────

export class TankAI implements IEnemyAI {
    private static readonly SPEED_MULT = 0.4;

    public update(enemy: EnemyStatusComponent, _dt: number, targetPos: { x: number; y: number }): { vx: number; vy: number } {
        const pos = enemy.node.position;
        const dx = targetPos.x - pos.x;
        const dy = targetPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return { vx: 0, vy: 0 };
        return {
            vx: (dx / dist) * enemy.moveSpeed * TankAI.SPEED_MULT,
            vy: (dy / dist) * enemy.moveSpeed * TankAI.SPEED_MULT,
        };
    }
}

// ────────────────────────────────
//  AI 工厂
// ────────────────────────────────

export function createEnemyAI(type: EnemyType): IEnemyAI {
    switch (type) {
        case EnemyType.CHARGER: return new ChargerAI();
        case EnemyType.FLANKER: return new FlankerAI();
        case EnemyType.TANK: return new TankAI();
        case EnemyType.GRUNT:
        case EnemyType.RANGED:
        default: return new GruntAI();
    }
}
