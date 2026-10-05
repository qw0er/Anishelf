const entry =
	"(?:public|policy)\\.ts$|^backend/src/modules/resource-access/files\\.ts$";
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
			name: "platform-does-not-import-business",
			severity: "error",
			from: { path: "^backend/src/platform/" },
			to: { path: "^backend/src/(modules|bootstrap|transport)/" },
		},
		{
			name: "domain-does-not-import-implementation",
			severity: "error",
			from: { path: "^backend/src/modules/[^/]+/domain/" },
			to: {
				path: "^backend/src/(?:modules/[^/]+/(?:application|infrastructure|http)/|modules/[^/]+/files\\.ts$|bootstrap/|transport/)|(?:^|/)fastify(?:/|$)",
			},
		},
		{
			name: "domain-does-not-load-platform-adapters",
			severity: "error",
			from: { path: "^backend/src/modules/[^/]+/domain/" },
			to: {
				path: "^backend/src/platform/",
				pathNot: "(?:policy|config|model|errors)\\.ts$",
				dependencyTypesNot: ["type-only"],
			},
		},
		{
			name: "public-and-policy-do-not-load-implementation",
			severity: "error",
			from: {
				path: "^backend/src/modules/[^/]+/(?:public|policy|ports)\\.ts$|^backend/src/modules/[^/]+/domain/policy\\.ts$",
			},
			to: {
				path: "^backend/src/modules/[^/]+/(?:application|infrastructure|http)/",
			},
		},
		{
			name: "web-only-imports-browser-contracts",
			severity: "error",
			from: { path: "^web/src/" },
			to: { path: "^backend/src/", pathNot: "^backend/src/contracts/" },
		},
		...["backend/src/modules", "web/src/features"].map((base) => ({
			name: base.startsWith("backend")
				? "backend-module-entry-points"
				: "web-feature-entry-points",
			severity: "error",
			from: { path: `^${base}/([^/]+)/` },
			to: {
				path: `^${base}/(?!$1/)[^/]+/`,
				pathNot: base.startsWith("backend") ? entry : "public\\.ts$",
			},
		})),
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
