/** Fixed adapter constraints, reviewed together with their implementations. */
export const adapterPolicy = Object.freeze({
	sqlite: Object.freeze({
		foreignKeys: "foreign_keys = ON",
		journal: "journal_mode = WAL",
		synchronous: "synchronous = FULL",
	}),
	static: Object.freeze({
		dotfiles: "deny" as const,
		maximumAgeMs: 0,
		pageCacheControl: "no-cache",
	}),
	logging: Object.freeze({
		redactPaths: Object.freeze([
			"password",
			"token",
			"secret",
			"authorization",
			"req.headers.authorization",
			"req.headers.cookie",
			'req.headers["x-csrf-token"]',
			'res.headers["set-cookie"]',
			"csrfToken",
			"currentPassword",
			"credential",
			"req.body",
			"res.body",
			"config",
			"settings",
		]),
	}),
});
