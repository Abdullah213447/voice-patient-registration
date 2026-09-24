export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'bad_request', message, details);
export const unauthorized = () => new AppError(401, 'unauthorized', 'Missing or invalid credentials.');
export const notFound = (message = 'Resource not found.') => new AppError(404, 'not_found', message);
export const validationFailed = (details) =>
  new AppError(422, 'validation_failed', 'One or more fields are invalid.', details);
