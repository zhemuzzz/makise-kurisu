/**
 * EvolutionService — 后台反思/学习编排器
 * 位置: src/evolution/evolution-service.ts
 *
 * EV-1~8: 路由 routine 到 Agent 后台模式
 * 不直接调 LLM — 仅编排，委派给 Agent 后台模式
 */

import type { MutationPipeline } from "./mutation-pipeline.js";
import type { MutationHealthReport } from "./types.js";
import type { EvolutionConfig } from "../platform/types/config.js";

// ============ DI Interfaces ============

export interface EvolutionTracing {
  log(event: unknown): void;
}

export interface BackgroundTaskContext {
  readonly routineId: string;
  readonly routineName: string;
  readonly taskGoal: string;
  readonly maxTokens: number;
}

export type ExecuteBackgroundTaskFn = (context: BackgroundTaskContext) => Promise<void>;

// ============ Config ============

export interface EvolutionServiceConfig {
  readonly evolutionConfig: EvolutionConfig;
  readonly pipeline: MutationPipeline;
  readonly tracing: EvolutionTracing;
  readonly executeBackgroundTask: ExecuteBackgroundTaskFn;
}

// ============ Interface ============

export interface EvolutionStatus {
  readonly enabled: boolean;
  readonly health: MutationHealthReport;
}

export interface EvolutionService {
  executeRoutine(routineId: string, routineName: string): Promise<void>;
  getStatus(): Promise<EvolutionStatus>;
  dispose(): void;
}

// ============ Routine Task Goals ============

const ROUTINE_TASK_GOALS: Readonly<Record<string, string>> = {
  "session-reflect": "反思本次对话，提取值得学习的内容并提交变更",
  "daily-learning": "学习兴趣领域的最新知识，更新知识库",
  "knowledge-consolidation": "整理知识库：合并重复、归档低效、淘汰过时条目",
};

// ============ Implementation ============

class EvolutionServiceImpl implements EvolutionService {
  constructor(private readonly config: EvolutionServiceConfig) {}

  async executeRoutine(routineId: string, routineName: string): Promise<void> {
    if (!this.config.evolutionConfig.enabled) {
      this.config.tracing.log({
        level: "info",
        category: "evolution",
        event: "evolution:skipped-disabled",
        data: { routineId },
      });
      return;
    }

    const taskGoal = ROUTINE_TASK_GOALS[routineId];
    if (!taskGoal) {
      this.config.tracing.log({
        level: "warn",
        category: "evolution",
        event: "evolution:unknown-routine",
        data: { routineId, routineName },
      });
      return;
    }

    try {
      await this.config.executeBackgroundTask({
        routineId,
        routineName,
        taskGoal,
        maxTokens: this.config.evolutionConfig.reflectionMaxTokens,
      });

      this.config.tracing.log({
        level: "info",
        category: "evolution",
        event: "evolution:routine:complete",
        data: { routineId, routineName },
      });
    } catch (error) {
      this.config.tracing.log({
        level: "error",
        category: "evolution",
        event: "evolution:routine:error",
        data: {
          routineId,
          routineName,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  async getStatus(): Promise<EvolutionStatus> {
    const health = await this.config.pipeline.getHealthReport();
    return {
      enabled: this.config.evolutionConfig.enabled,
      health,
    };
  }

  dispose(): void {
    this.config.pipeline.dispose();
    this.config.tracing.log({
      level: "info",
      category: "evolution",
      event: "evolution:disposed",
    });
  }
}

// ============ Factory ============

export function createEvolutionService(config: EvolutionServiceConfig): EvolutionService {
  return new EvolutionServiceImpl(config);
}
