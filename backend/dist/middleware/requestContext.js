import { randomUUID } from 'crypto';
export function requestContext(req, res, next) {
    const incoming = req.header('x-request-id')?.trim();
    const requestId = incoming || randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
}
