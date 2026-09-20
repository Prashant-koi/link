// Thrown by services, mapped to a JSON response by `wrap` in the routes.
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
