export interface MediaToolsLogger {
	child?(bindings: Record<string, unknown>): MediaToolsLogger;
	debug(obj: Record<string, unknown>, msg?: string): void;
	info(obj: Record<string, unknown>, msg?: string): void;
	warn(obj: Record<string, unknown>, msg?: string): void;
}
