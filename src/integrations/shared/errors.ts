export class IntegrationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    message: string,
    public readonly retriable: boolean = false,
    public readonly cause?: unknown,
  ) {
    super(`[${provider}] ${code}: ${message}`);
    this.name = "IntegrationError";
  }
}
