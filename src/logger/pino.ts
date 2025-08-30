import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import pino, {
	type Logger as PinoLoggerType,
	stdSerializers,
	type TransportTargetOptions,
	transport,
} from "pino";
import type { ContextObject, Logger, LogLevel } from "./logger.ts";

/*=============================== Constants ===================================*/

const scopeStorage = new AsyncLocalStorage<ContextObject>();

/** Pretty console target (stdout) */
const TARGET_STDOUT_PRETTY: TransportTargetOptions = {
	target: "pino-pretty",
	options: {
		colorize: true,
		translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
		singleLine: true,
	},
};

/** JSON console target (stdout) */
const TARGET_STDOUT_JSON: TransportTargetOptions = {
	target: "pino/file",
	options: { destination: 1 }, // 1 = stdout
};

/**
 * Options for creating a PinoLogger instance.
 * @param level - Log level, defaults to 'info' in production and 'debug' otherwise
 * @param file - Optional file path for additional NDJSON log file output
 * @param format - Output format: 'pretty' for development, 'json' for production
 */
export type PinoLoggerOptions = {
	level?: LogLevel;
	file?: string;
	format?: "json" | "pretty";
};

/**
 * Pino-based implementation of the `Logger` interface with AsyncLocalStorage scoping.
 * Provides high-performance structured logging with automatic request/response serialization.
 *
 * ```typescript
 * // Create root logger (once per process)
 * const logger = PinoLogger.create({
 *   level: "info",
 *   format: "pretty",
 *   file: "./logs/app.log"
 * });
 *
 * // Use beginScope() for request-scoped context
 * await logger.beginScope({ requestId }, async () => {
 *   logger.info("Processing request", { req }); // includes requestId
 *   logger.error("Payment failed", { err: paymentError, amount: 100 });
 * });
 *
 * // Use child() for persistent service-level context
 * const serviceLogger = logger.child({ service: "payments" });
 * ```
 *
 * Only create one root instance per process - use `logger.child()` for additional loggers.
 */
export class PinoLogger implements Logger {
	#pino: PinoLoggerType;

	private constructor(pinoLogger: PinoLoggerType) {
		this.#pino = pinoLogger;
	}

	/**
	 * Creates a root PinoLogger instance with the specified configuration.
	 * Only create one root instance per process - use `logger.child()` for additional loggers.
	 */
	static create(opts: PinoLoggerOptions = {}): PinoLogger {
		// Set defaults based on production
		const isProduction = process.env.NODE_ENV === "production";

		const level = opts.level || isProduction ? "info" : "debug";
		const format = opts.format || isProduction ? "json" : "pretty";

		// Build list of targets
		const targets: TransportTargetOptions[] = [];

		// Stdout always
		if (format === "pretty") {
			targets.push(TARGET_STDOUT_PRETTY);
		} else {
			targets.push(TARGET_STDOUT_JSON);
		}

		// Optional file
		if (opts.file) {
			const dest = path.resolve(opts.file);
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			targets.push({
				target: "pino/file",
				options: { destination: dest, mkdir: true }, // ndjson file
			});
		}

		// Create pino instance
		const base = pino(
			{
				level,
				serializers: {
					err: stdSerializers.err,
					req: stdSerializers.req,
					res: stdSerializers.res,
				},
			},
			transport({ targets }),
		);

		return new PinoLogger(base);
	}

	level(): LogLevel {
		return this.#pino.level as LogLevel;
	}
	setLevel(level: LogLevel) {
		this.#pino.level = level;
	}

	info(message: string, context?: ContextObject) {
		if (!this.#pino.isLevelEnabled("info")) return;

		const mergedContext = this.#mergeWithScope(context);
		mergedContext
			? this.#pino.info(mergedContext, message)
			: this.#pino.info(message);
	}
	debug(message: string, context?: ContextObject) {
		if (!this.#pino.isLevelEnabled("debug")) return;

		const mergedContext = this.#mergeWithScope(context);
		mergedContext
			? this.#pino.debug(mergedContext, message)
			: this.#pino.debug(message);
	}

	error(message: string, contextOrError?: ContextObject | Error) {
		let ctxObject: ContextObject = {};

		if (contextOrError instanceof Error) {
			ctxObject = { err: contextOrError };
		} else if (contextOrError) {
			ctxObject = contextOrError;
		}

		const mergedContext = this.#mergeWithScope(ctxObject);
		this.#pino.error(mergedContext, message);
	}

	child(bindings: ContextObject = {}): Logger {
		// Per-request child loggers are idiomatic and cheap.
		return new PinoLogger(this.#pino.child(bindings));
	}

	beginScope<T>(context: ContextObject, fn: () => Promise<T>): Promise<T> {
		const parentScope = scopeStorage.getStore() || {};
		const mergedScope = { ...parentScope, ...context };
		return scopeStorage.run(mergedScope, fn);
	}

	#mergeWithScope(context?: ContextObject): ContextObject | undefined {
		const scopeContext = scopeStorage.getStore();
		if (!scopeContext && !context) return undefined;
		if (!scopeContext) return context;
		if (!context) return scopeContext;
		return { ...scopeContext, ...context };
	}
}
