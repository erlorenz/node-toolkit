import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "./logger.ts";

export const DEFAULT_SKIP_PATHS = [
	"/health",
	"/healthz",
	"/up",
	"/ping",
	"/metrics",
	"/favicon.ico",
];

/**
 * Express middleware for logging HTTP requests and responses with automatic request ID correlation.
 * Generates or extracts request IDs, sets response headers, and uses `beginScope()` for automatic context propagation.
 *
 * ```typescript
 * // Use with defaults (skips health checks)
 * app.use(logRequestMiddleware(logger));
 *
 * // Custom skip paths
 * app.use(logRequestMiddleware(logger, ['/custom-health', '/status']));
 *
 * // Extend defaults
 * app.use(logRequestMiddleware(logger, [...DEFAULT_SKIP_PATHS, '/admin/ping']));
 *
 * // Log everything
 * app.use(logRequestMiddleware(logger, []));
 * ```
 */
export function logRequestMiddleware(
	logger: Logger,
	skipPaths: string[] = DEFAULT_SKIP_PATHS,
) {
	return async (req: Request, res: Response, next: NextFunction) => {
		// Skip logging for specified paths
		if (skipPaths.includes(req.path)) {
			return next();
		}
		const requestId =
			typeof req.headers["x-request-id"] === "string"
				? req.headers["x-request-id"] || randomUUID()
				: randomUUID();

		// Add request ID to response header
		res.setHeader("X-Request-Id", requestId);

		const startTime = performance.now();

		await logger.beginScope({ requestId }, async () => {
			// Log incoming request
			logger.info("Incoming request", { req });

			// Listen for response finish to log outgoing response
			res.on("finish", () => {
				const duration = performance.now() - startTime;
				logger.info("Outgoing response", { res, duration });
			});

			next();
		});
	};
}
