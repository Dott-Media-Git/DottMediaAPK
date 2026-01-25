const DEFAULT_REPLY_TIMEOUT_MS = 12000;
const parseTimeout = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_REPLY_TIMEOUT_MS;
    }
    return parsed;
};
export const OPENAI_REPLY_TIMEOUT_MS = parseTimeout(process.env.OPENAI_REPLY_TIMEOUT_MS);
