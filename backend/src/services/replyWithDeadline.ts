/** Bound response generation without retrying a message whose send is uncertain. */
export async function replyWithDeadline(generated: Promise<string>, fallback: string, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      generated.catch(() => fallback),
      new Promise<string>(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
