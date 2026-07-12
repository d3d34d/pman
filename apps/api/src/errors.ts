export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

export function notFound(what: string): AppError {
  return new AppError(404, `${what} not found`)
}

export function badRequest(message: string): AppError {
  return new AppError(400, message)
}
