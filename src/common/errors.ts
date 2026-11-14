/** An error that maps directly onto an HTTP response. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown): AppError {
    return new AppError(400, code, message, details);
  }

  static forbidden(message: string, code = 'FORBIDDEN'): AppError {
    return new AppError(403, code, message);
  }

  static notFound(message: string, code = 'NOT_FOUND', details?: unknown): AppError {
    return new AppError(404, code, message, details);
  }

  static conflict(message: string, code = 'CONFLICT'): AppError {
    return new AppError(409, code, message);
  }
}
