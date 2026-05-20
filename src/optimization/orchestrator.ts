import { ChildProcess, fork } from "child_process";

/** Configuration for a single bot worker process. */
export interface BotWorkerConfig {
  id: string;
  scriptPath: string;
  env?: Record<string, string>;
  args?: string[];
  /** Max restarts before giving up. */
  maxRestarts?: number;
  /** Delay between restart attempts (ms). */
  restartDelayMs?: number;
  /** Kill timeout if graceful exit fails (ms). */
  killTimeoutMs?: number;
}

/** Current status of a bot worker. */
export type WorkerStatus =
  | "starting"
  | "running"
  | "stopping"
  | "crashed"
  | "exited"
  | "restarting"
  | "dead";

export interface BotWorkerState {
  id: string;
  status: WorkerStatus;
  process: ChildProcess | null;
  restarts: number;
  startTime: number | null;
  exitTime: number | null;
  lastExitCode: number | null;
  messages: WorkerMessage[];
}

export interface WorkerMessage {
  type: "stdout" | "stderr" | "error" | "ipc";
  data: string;
  timestamp: number;
}

/** Orchestrator that manages 1 child_process per bot. */
export class BotOrchestrator {
  private workers = new Map<string, BotWorkerState>();
  private configs = new Map<string, BotWorkerConfig>();
  private messageLimit = 200;

  /** Spawn a new bot worker process. */
  spawn(config: BotWorkerConfig): BotWorkerState {
    if (this.workers.has(config.id)) {
      throw new Error(`Worker ${config.id} already exists. Stop it first.`);
    }

    const state: BotWorkerState = {
      id: config.id,
      status: "starting",
      process: null,
      restarts: 0,
      startTime: null,
      exitTime: null,
      lastExitCode: null,
      messages: [],
    };

    this.workers.set(config.id, state);
    this.configs.set(config.id, config);
    this._startProcess(state, config);
    return state;
  }

  private _startProcess(state: BotWorkerState, config: BotWorkerConfig): void {
    state.status = "starting";
    const proc = fork(config.scriptPath, config.args ?? [], {
      env: { ...process.env, ...config.env },
      silent: true,
      execPath: process.execPath,
    });

    state.process = proc;
    state.startTime = Date.now();
    state.status = "running";

    proc.stdout?.on("data", (data: Buffer) => {
      this._pushMessage(state, { type: "stdout", data: data.toString(), timestamp: Date.now() });
    });

    proc.stderr?.on("data", (data: Buffer) => {
      this._pushMessage(state, { type: "stderr", data: data.toString(), timestamp: Date.now() });
    });

    proc.on("message", (msg: unknown) => {
      this._pushMessage(state, {
        type: "ipc",
        data: typeof msg === "string" ? msg : JSON.stringify(msg),
        timestamp: Date.now(),
      });
    });

    proc.on("error", (err: Error) => {
      this._pushMessage(state, { type: "error", data: err.message, timestamp: Date.now() });
      state.status = "crashed";
    });

    proc.on("exit", (code: number | null, signal: string | null) => {
      state.exitTime = Date.now();
      state.lastExitCode = code ?? -1;
      state.process = null;

      const maxRestarts = config.maxRestarts ?? 5;
      const restartDelay = config.restartDelayMs ?? 3000;

      if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
        state.status = "exited";
        return;
      }

      if (state.restarts >= maxRestarts) {
        state.status = "dead";
        this._pushMessage(state, {
          type: "error",
          data: `Max restarts (${maxRestarts}) reached. Worker marked dead.`,
          timestamp: Date.now(),
        });
        return;
      }

      state.status = "restarting";
      state.restarts++;
      this._pushMessage(state, {
        type: "error",
        data: `Restart ${state.restarts}/${maxRestarts} in ${restartDelay}ms...`,
        timestamp: Date.now(),
      });

      setTimeout(() => {
        if (this.workers.has(state.id)) {
          this._startProcess(state, config);
        }
      }, restartDelay);
    });
  }

  private _pushMessage(state: BotWorkerState, msg: WorkerMessage): void {
    state.messages.push(msg);
    if (state.messages.length > this.messageLimit) {
      state.messages.shift();
    }
  }

  /** Gracefully stop a worker. */
  stop(id: string): boolean {
    const state = this.workers.get(id);
    if (!state || !state.process) return false;

    state.status = "stopping";
    const config = this.configs.get(id)!;
    const killTimeout = config.killTimeoutMs ?? 5000;

    state.process.send?.("shutdown");

    const timeout = setTimeout(() => {
      if (state.process && !state.process.killed) {
        state.process.kill("SIGTERM");
      }
      const forceTimeout = setTimeout(() => {
        if (state.process && !state.process.killed) {
          state.process.kill("SIGKILL");
        }
      }, killTimeout);
      // Allow Node to exit if orchestrator itself exits
      forceTimeout.unref?.();
    }, 1000);
    timeout.unref?.();

    return true;
  }

  /** Kill a worker immediately. */
  kill(id: string): boolean {
    const state = this.workers.get(id);
    if (!state || !state.process) return false;
    state.process.kill("SIGKILL");
    return true;
  }

  /** Remove a worker from tracking. */
  remove(id: string): boolean {
    this.stop(id);
    return this.workers.delete(id);
  }

  /** Get worker state. */
  getState(id: string): BotWorkerState | undefined {
    return this.workers.get(id);
  }

  /** List all worker IDs. */
  listWorkers(): string[] {
    return Array.from(this.workers.keys());
  }

  /** Health snapshot of all workers. */
  health(): OrchestratorHealth {
    const workers: WorkerHealth[] = [];
    let running = 0;
    let crashed = 0;
    let dead = 0;

    Array.from(this.workers).forEach(([id, state]) => {
      if (state.status === "running") running++;
      if (state.status === "crashed" || state.status === "restarting") crashed++;
      if (state.status === "dead") dead++;

      workers.push({
        id,
        status: state.status,
        restarts: state.restarts,
        uptimeMs: state.startTime ? Date.now() - state.startTime : 0,
        lastExitCode: state.lastExitCode,
      });
    });

    return { running, crashed, dead, total: this.workers.size, workers };
  }

  /** Gracefully stop all workers and clear state. */
  shutdown(): void {
    Array.from(this.workers.keys()).forEach((id) => {
      this.stop(id);
    });
    this.workers.clear();
    this.configs.clear();
  }
}

export interface WorkerHealth {
  id: string;
  status: WorkerStatus;
  restarts: number;
  uptimeMs: number;
  lastExitCode: number | null;
}

export interface OrchestratorHealth {
  running: number;
  crashed: number;
  dead: number;
  total: number;
  workers: WorkerHealth[];
}
