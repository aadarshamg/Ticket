import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { MAX_UPLOAD_BYTES } from '../config/constants';

export interface ErrorDetail {
  path: string;
  message: string;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'not_found', 'Not found'));
};

function send(res: Parameters<ErrorRequestHandler>[2], status: number, code: string, message: string, details?: ErrorDetail[]) {
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return send(res, err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    return send(res, 400, 'validation_error', 'Some fields are invalid', details);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return send(res, 409, 'conflict', 'That value is already in use');
  }
  if (err instanceof MulterError) {
    return err.code === 'LIMIT_FILE_SIZE'
      ? send(res, 413, 'too_large', `The file is too large (maximum ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`)
      : send(res, 400, 'invalid_file', 'Upload one spreadsheet file in the "file" field');
  }
  // body-parser errors
  if (err?.type === 'entity.parse.failed') {
    return send(res, 400, 'invalid_json', 'Request body is not valid JSON');
  }
  if (err?.type === 'entity.too.large') {
    return send(res, 413, 'too_large', 'Request body is too large');
  }

  console.error(err);
  return send(res, 500, 'internal_error', 'Something went wrong');
};
