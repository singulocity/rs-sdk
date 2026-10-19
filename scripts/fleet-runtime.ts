import {
  executionContext,
  executionWait,
  abortable,
} from "../sdk/execution-context";

export function trainingSleep(
  ms: number,
  signal = executionContext.getStore()?.signal,
): Promise<void> {
  return executionWait<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    return () => clearTimeout(timer);
  }, signal);
}

export interface FleetSession {
  connect(): Promise<void>;
  run(): Promise<void>;
  disconnect(): Promise<void>;
  onDisconnect(abort: () => void): () => void;
}
export type SessionStatus = "connecting" | "running" | "retrying" | "stopped";

/** Each bot owns its connection, cancellation scope and retry loop. No process-wide credentials or exits. */
export async function superviseBot(options: {
  create: () => FleetSession;
  signal: AbortSignal;
  status: (state: SessionStatus, error?: unknown) => void;
  log?: (level: "log" | "warn" | "error", args: unknown[]) => void;
  retryMs?: number;
}) {
  while (!options.signal.aborted) {
    const attempt = new AbortController();
    const cancel = () => attempt.abort(options.signal.reason);
    options.signal.addEventListener("abort", cancel, { once: true });
    if (options.signal.aborted) cancel();
    let session: FleetSession | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      await executionContext.run(
        { signal: attempt.signal, log: options.log },
        async () => {
          session = options.create();
          unsubscribe = session.onDisconnect(() =>
            attempt.abort(new Error("Bot connection lost.")),
          );
          options.status("connecting");
          await abortable(session.connect());
          options.status("running");
          await abortable(session.run());
          if (!options.signal.aborted)
            throw new Error("Training routine ended; restarting.");
        },
      );
    } catch (error) {
      if (!options.signal.aborted) options.status("retrying", error);
    } finally {
      attempt.abort(new Error("Bot execution finished."));
      unsubscribe?.();
      options.signal.removeEventListener("abort", cancel);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          session?.disconnect(),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 3000);
          }),
        ]);
      } catch {
      } finally {
        clearTimeout(timer);
      }
    }
    if (!options.signal.aborted)
      await trainingSleep(options.retryMs ?? 3000, options.signal).catch(
        () => {},
      );
  }
  options.status("stopped");
}
