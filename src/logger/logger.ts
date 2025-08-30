const LOG_LEVELS = ["error", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type ContextObject = Record<string, unknown>;

/**
 * Structured logger interface with async context scoping support.
 * Supports child loggers for persistent context and `beginScope()` for automatic async context propagation.
 *
 * ```typescript
 * // Basic logging
 * logger.info("Request processed", { userId: 123 });
 * logger.error("Database failed", dbError);
 * logger.error("Validation failed", { err: validationError, input: data });
 *
 * // Child loggers for persistent context
 * const serviceLogger = logger.child({ service: "payments" });
 *
 * // Async scopes for transient context
 * await logger.beginScope({ requestId }, async () => {
 *   logger.info("Processing request"); // automatically includes requestId
 * });
 * ```
 */
export interface Logger {
	level(): LogLevel;
	setLevel(level: LogLevel): void;

	info(message: string, context?: ContextObject): void;
	debug(message: string, context?: ContextObject): void;
	error(message: string, contextOrError?: ContextObject | Error): void;

	child(bindings?: ContextObject): Logger;
	beginScope<T>(context: ContextObject, fn: () => Promise<T>): Promise<T>;
}
