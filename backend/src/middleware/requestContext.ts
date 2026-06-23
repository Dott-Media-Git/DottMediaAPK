import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export interface RequestWithContext extends Request {
  requestId?: string;
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id')?.trim();
  const requestId = incoming || randomUUID();
  (req as RequestWithContext).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
