// Work that must not hold up (or change the timing of) an HTTP response, such
// as sending email. Failures are logged by label only, never with the payload.
// A real job queue replaces this in B2.
const pending = new Set<Promise<void>>();

export function runInBackground(label: string, task: () => Promise<unknown>) {
  const promise: Promise<void> = Promise.resolve()
    .then(task)
    .then(
      () => undefined,
      (error: unknown) => {
        console.error(`Background task "${label}" failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    )
    .finally(() => pending.delete(promise));
  pending.add(promise);
}

// Waits until all background work (including work it starts) has finished. For tests.
export async function settleBackgroundTasks() {
  while (pending.size > 0) await Promise.all([...pending]);
}
