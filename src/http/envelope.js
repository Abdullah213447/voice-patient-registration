import { AppError } from './errors.js';
import { logger } from '../logger.js';

/** Every response uses the same envelope: `{ data, error }` (+ optional `meta`). */
export function sendData(res, data, status = 200, meta) {
  res.status(status).json(meta ? { data, error: null, meta } : { data, error: null });
}

export function sendError(res, status, code, message, details) {
  res.status(status).json({ data: null, error: { code, message, ...(details ? { details } : {}) } });
}

export function notFoundHandler(req, res) {
  sendError(res, 404, 'not_found', `No route for ${req.method} ${req.path}`);
}

// Express 5 forwards rejected promises from async handlers here automatically.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) return sendError(res, err.status, err.code, err.message, err.details);
  // body-parser: malformed JSON or oversized payload.
  if (err.type === 'entity.parse.failed') return sendError(res, 400, 'bad_request', 'Request body is not valid JSON.');
  if (err.type === 'entity.too.large') return sendError(res, 413, 'payload_too_large', 'Request body is too large.');
  logger.error({ err, path: req.path }, 'unhandled error');
  return sendError(res, 500, 'internal_error', 'Something went wrong on our side.');
}
