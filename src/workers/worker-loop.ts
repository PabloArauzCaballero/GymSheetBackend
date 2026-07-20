export async function sleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    // `finish` closes over the handle before `setTimeout` returns it, so the
    // binding must be declared ahead of its assignment and cannot be `const`.
    // eslint-disable-next-line prefer-const
    let timeout: ReturnType<typeof setTimeout>;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => finish();

    timeout = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) finish();
  });
}

export async function runBounded<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    await Promise.all(batch.map(handler));
  }
}
