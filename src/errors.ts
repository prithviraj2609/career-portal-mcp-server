export type CareerPortalErrorCode =
  | "AUTH_REQUIRED"
  | "SCOPE_REQUIRED"
  | "CAPABILITY_UNAVAILABLE"
  | "MUTATION_DISABLED"
  | "CONFIRMATION_REQUIRED"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "ANTI_BOT_CHALLENGE"
  | "STATE_DRIFT"
  | "PROVIDER_CHANGED"
  | "TIMEOUT"
  | "OUTCOME_UNKNOWN"
  | "PROVIDER_ERROR";

export class CareerPortalError extends Error {
  constructor(
    public readonly code: CareerPortalErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "CareerPortalError";
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: this.retryAfterMs }),
    };
  }
}
