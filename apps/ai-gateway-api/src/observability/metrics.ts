export class GatewayMetrics {
  private requestsTotal = 0;
  private streamsTotal = 0;
  private successes = 0;
  private cancellations = 0;
  private rejections = 0;
  private timeouts = 0;
  private providerErrors = 0;
  private rateLimited = 0;
  private budgetExceeded = 0;
  private activeStreams = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  recordRequest(stream: boolean): void {
    this.requestsTotal += 1;
    if (stream) this.streamsTotal += 1;
  }
  beginStream(): void {
    this.activeStreams += 1;
  }
  endStream(): void {
    this.activeStreams = Math.max(0, this.activeStreams - 1);
  }
  success(usage?: { inputTokens?: number; outputTokens?: number }): void {
    this.successes += 1;
    this.inputTokens += usage?.inputTokens ?? 0;
    this.outputTokens += usage?.outputTokens ?? 0;
  }
  cancel(): void {
    this.cancellations += 1;
  }
  reject(code?: string): void {
    this.rejections += 1;
    if (code === "RATE_LIMITED") this.rateLimited += 1;
    if (code === "BUDGET_EXCEEDED") this.budgetExceeded += 1;
    if (code === "PROVIDER_TIMEOUT") this.timeouts += 1;
    if (code === "PROVIDER_UNAVAILABLE" || code === "MALFORMED_PROVIDER_RESPONSE") {
      this.providerErrors += 1;
    }
  }
  snapshot() {
    return {
      requestsTotal: this.requestsTotal,
      streamsTotal: this.streamsTotal,
      successes: this.successes,
      cancellations: this.cancellations,
      rejections: this.rejections,
      timeouts: this.timeouts,
      providerErrors: this.providerErrors,
      rateLimited: this.rateLimited,
      budgetExceeded: this.budgetExceeded,
      activeStreams: this.activeStreams,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }
}
