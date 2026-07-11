export const safeErrorCodes = [
  "UNAUTHENTICATED", "FORBIDDEN", "VALIDATION_ERROR", "RATE_LIMITED", "TIMEOUT",
  "UPSTREAM_ERROR", "CONFIGURATION_ERROR", "INTERNAL_ERROR"
] as const;
export type SafeRuntimeErrorCode = (typeof safeErrorCodes)[number];
export type SafeRuntimeErrorShape = { code: SafeRuntimeErrorCode; message: string; requestId: string; retryable?: boolean };

export class SafeRuntimeError extends Error {
  readonly code: SafeRuntimeErrorCode;
  readonly requestId: string;
  readonly retryable?: boolean;
  constructor(shape: SafeRuntimeErrorShape, options?: ErrorOptions) {
    super(shape.message, options);
    this.name = "SafeRuntimeError";
    this.code = shape.code;
    this.requestId = shape.requestId;
    if (shape.retryable !== undefined) this.retryable = shape.retryable;
  }
  toJSON(): SafeRuntimeErrorShape {
    return { code: this.code, message: this.message, requestId: this.requestId, ...(this.retryable === undefined ? {} : { retryable: this.retryable }) };
  }
}

export function asSafeRuntimeError(error: unknown, requestId: string): SafeRuntimeError {
  if (error instanceof SafeRuntimeError) return error;
  return new SafeRuntimeError({ code: "INTERNAL_ERROR", message: "The function could not be completed.", requestId }, { cause: error });
}
