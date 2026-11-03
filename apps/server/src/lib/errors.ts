export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError('VALIDATION_ERROR', 400, message, details);
}

export function unauthorized(message = '请先选择身份'): AppError {
  return new AppError('UNAUTHORIZED', 401, message);
}

export function notFound(message = '找不到内容'): AppError {
  return new AppError('NOT_FOUND', 404, message);
}

export function forbidden(message = '没有权限做这个操作'): AppError {
  return new AppError('FORBIDDEN', 403, message);
}

export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(code, 409, message, details);
}
