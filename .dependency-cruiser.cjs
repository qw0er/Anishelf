const modulePath = "backend/src/modules/[^/]+/[^/]+/";
const implementation = `${modulePath}(?:(?:application|infrastructure|http)(?:/|\\.ts$)|files\\.ts$)`;
module.exports = {
	forbidden: [
		{
			name: "no-unresolved-source-imports",
			severity: "error",
			from: { path: "^(backend|web)/src" },
			to: { couldNotResolve: true },
		},
		{
			name: "no-runtime-cycles",
			severity: "error",
			from: { path: "^(backend|web)/src" },
			to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
		},
		{
			name: "domain-and-ports-do-not-import-http-dtos",
			severity: "error",
			from: {
				path: `^${modulePath}(?:domain/|ports\\.ts$|settings\\.ts$|profile\\.ts$|snapshot\\.ts$|negotiation\\.ts$|result\\.ts$)|^backend/src/shared/`,
			},
			to: { path: "^backend/src/contracts/(?:http\\.ts$|schemas/)" },
		},
		{
			name: "platform-does-not-import-business",
			severity: "error",
			from: { path: "^backend/src/platform/" },
			to: { path: "^backend/src/(modules|app|transport)/" },
		},
		{
			name: "shared-does-not-import-business",
			severity: "error",
			from: { path: "^backend/src/shared/" },
			to: { path: "^backend/src/(modules|app|platform|transport)/" },
		},
		{
			name: "modules-do-not-import-app",
			severity: "error",
			from: { path: `^${modulePath}` },
			to: { path: "^backend/src/app/" },
		},
		{
			name: "domain-does-not-import-implementation",
			severity: "error",
			from: { path: `^${modulePath}domain/` },
			to: {
				path: `^${implementation}|^backend/src/(app|transport)/|(?:^|/)fastify(?:/|$)`,
			},
		},
		{
			name: "domain-does-not-load-platform-adapters",
			severity: "error",
			from: { path: `^${modulePath}domain/` },
			to: {
				path: "^backend/src/platform/",
				pathNot: "(?:policy|config|model|errors)\\.ts$",
				dependencyTypesNot: ["type-only"],
			},
		},
		{
			name: "public-and-policy-do-not-load-implementation",
			severity: "error",
			from: { path: `^${modulePath}(?:public|policy|ports)\\.ts$` },
			to: { path: `^${implementation}` },
		},
		{
			name: "backend-module-entry-points",
			severity: "error",
			from: { path: "^backend/src/modules/([^/]+/[^/]+)/" },
			to: {
				path: "^backend/src/modules/(?!$1/)[^/]+/[^/]+/",
				pathNot: "(?:public|policy|persistence)\\.ts$",
			},
		},
		{
			name: "backend-external-consumers-use-public-api",
			severity: "error",
			from: { path: "^backend/src/", pathNot: "^backend/src/(app|modules)/" },
			to: { path: `^${modulePath}`, pathNot: "(?:public|policy)\\.ts$" },
		},
		{
			name: "http-does-not-call-other-modules",
			severity: "error",
			from: { path: "^backend/src/modules/([^/]+/[^/]+)/http/" },
			to: {
				path: "^backend/src/modules/(?!$1/)[^/]+/[^/]+/",
				dependencyTypesNot: ["type-only"],
			},
		},
		{
			name: "http-does-not-import-infrastructure",
			severity: "error",
			from: { path: `^${modulePath}http/` },
			to: { path: `^${modulePath}infrastructure/` },
		},

		{
			name: "persistence-is-adapter-only",
			severity: "error",
			from: {
				path: "^backend/src/",
				pathNot: `^backend/src/app/|^${modulePath}(?:infrastructure/(?:schema|repository)\\.ts$|persistence\\.ts$)`,
			},
			to: { path: `^${modulePath}persistence\\.ts$` },
		},
		{
			name: "web-only-imports-browser-contracts",
			severity: "error",
			from: { path: "^web/src/" },
			to: { path: "^backend/src/", pathNot: "^backend/src/contracts/" },
		},
		{
			name: "web-feature-entry-points",
			severity: "error",
			from: { path: "^web/src/features/([^/]+)/" },
			to: { path: "^web/src/features/(?!$1/)[^/]+/", pathNot: "public\\.ts$" },
		},
		{
			name: "web-app-uses-feature-public-api",
			severity: "error",
			from: { path: "^web/src/app/|^web/src/main\\.tsx$" },
			to: { path: "^web/src/features/", pathNot: "public\\.ts$" },
		},
		{
			name: "web-shared-does-not-import-features",
			severity: "error",
			from: { path: "^web/src/shared/" },
			to: { path: "^web/src/(features|app)/" },
		},
		{
			name: "web-features-do-not-import-app",
			severity: "error",
			from: { path: "^web/src/features/" },
			to: { path: "^web/src/app/" },
		},
	],
	options: {
		doNotFollow: { path: "node_modules" },
		tsPreCompilationDeps: true,
		enhancedResolveOptions: {
			exportsFields: ["exports"],
			conditionNames: ["types", "import", "node", "default"],
			mainFields: ["types", "module", "main"],
		},
	},
};
