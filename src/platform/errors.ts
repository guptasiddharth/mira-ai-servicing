/** Errors that tools raise deliberately. Their messages are safe to show the model and the customer. */

/** The requested resource does not belong to the authenticated customer. */
export class AccessDeniedError extends Error {
  constructor(message = "This resource is not linked to your account.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

/** A business rule prevents the request (e.g. lock-in period). */
export class BusinessRuleError extends Error {
  constructor(
    message: string,
    public readonly ruleIds: string[] = [],
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
