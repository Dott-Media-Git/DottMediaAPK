export type RetryOptions = {
  retries?: number;
  delayMs?: number;
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const withRetry = async <T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> => {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 400;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      attempt += 1;
      await wait(delayMs * attempt);
    }
  }
};
