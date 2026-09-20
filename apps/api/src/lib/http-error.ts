export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const httpError = (statusCode: number, code: string, message: string) =>
  new HttpError(statusCode, code, message);
