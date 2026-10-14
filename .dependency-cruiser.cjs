const modulePath = "backend/src/modules/[^/]+/[^/]+/";
const implementation = `${modulePath}(?:(?:application|infrastructure|http)(?:/|\\.ts$)|files\\.ts$)`;
module.exports = {
	forbidden: [
		{
			name: "configuration-application-does-not-project-http",
			severity: "error",
			from: { path: "^backend/src/modules/system/configuration/application/" },
			to: { path: "^backend/src/contracts/(?:http\\.ts$|schemas/)" },
		},
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
			from: {
				path: "^backend/src/modules/([^/]+)/(?!composition/|workflows/)([^/]+)/",
			},
			to: {
				path: "^backend/src/modules/$1/(?!$2/)[^/]+/",
				pathNot: "(?:public|policy|persistence)\\.ts$",
			},
		},
		{
			name: "large-public-does-not-load-implementation",
			severity: "error",
			from: { path: "^backend/src/modules/[^/]+/public\\.ts$" },
			to: {
				path: "^backend/src/modules/[^/]+/(?:composition/|create\\.ts$|http\\.ts$|persistence\\.ts$)|^backend/src/modules/[^/]+/[^/]+/(?:application(?:/|\\.ts$)|infrastructure/|http/)",
			},
		},

		{
			name: "backend-large-module-boundary",
			severity: "error",
			from: { path: "^backend/src/modules/([^/]+)/" },
			to: {
				path: "^backend/src/modules/(?!$1/)[^/]+/",
				pathNot: "^backend/src/modules/[^/]+/(?:public|persistence)\\.ts$",
			},
		},
		{
			name: "backend-app-uses-module-entries",
			severity: "error",
			from: { path: "^backend/src/app/" },
			to: {
				path: "^backend/src/modules/",
				pathNot:
					"^backend/src/modules/[^/]+/(?:public|create|http|persistence)\\.ts$",
			},
		},
		{
			name: "backend-external-consumers-use-public-api",
			severity: "error",
			from: { path: "^backend/src/", pathNot: "^backend/src/(app|modules)/" },
			to: {
				path: "^backend/src/modules/",
				pathNot: "^backend/src/modules/[^/]+/public\\.ts$",
			},
		},
		{
			name: "business-does-not-use-assembly-entries",
			severity: "error",
			from: {
				path: "^backend/src/modules/",
				pathNot:
					"^backend/src/modules/[^/]+/(?:create|http|persistence)\\.ts$|^backend/src/modules/[^/]+/composition/",
			},
			to: { path: "^backend/src/modules/[^/]+/(?:create|http)\\.ts$" },
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
				pathNot:
					"^backend/src/app/|^backend/src/modules/[^/]+/(?:create|persistence)\\.ts$|^backend/src/modules/[^/]+/composition/|^backend/src/modules/[^/]+/[^/]+/infrastructure/(?:schema|repository)\\.ts$",
			},
			to: {
				path: "^backend/src/modules/[^/]+/persistence\\.ts$|^backend/src/modules/[^/]+/[^/]+/persistence\\.ts$",
			},
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
			from: {
				path: "^web/src/features/(resources|media|playback)/([^/]+)/",
			},
			to: {
				path: "^web/src/features/$1/(?!$2/)[^/]+/",
				pathNot: "public\\.ts$",
			},
		},
		{
			name: "web-anime-feature-entry-points",
			severity: "error",
			from: { path: "^web/src/features/anime/(catalog|metadata|review)/" },
			to: {
				path: "^web/src/features/anime/(?!$1/)(catalog|metadata|review)/",
				pathNot: "public\\.ts$",
			},
		},
		{
			name: "web-anime-catalog-does-not-import-review",
			severity: "error",
			from: { path: "^web/src/features/anime/catalog/" },
			to: { path: "^web/src/features/anime/review/" },
		},
		{
			name: "web-anime-metadata-is-independent",
			severity: "error",
			from: { path: "^web/src/features/anime/metadata/" },
			to: { path: "^web/src/features/anime/(catalog|review)/" },
		},
		{
			name: "web-anime-shared-is-a-leaf",
			severity: "error",
			from: { path: "^web/src/features/anime/shared/" },
			to: {
				path: "^web/src/features/anime/",
				pathNot: "^web/src/features/anime/shared/",
			},
		},
		{
			name: "web-public-does-not-load-ui-barrels",
			severity: "error",
			from: { path: "^web/src/features/[^/]+/public\\.ts$" },
			to: {
				path: "^web/src/features/.*/ui\\.ts$",
				reachable: true,
			},
		},
		{
			name: "web-large-module-boundary",
			severity: "error",
			from: { path: "^web/src/features/([^/]+)/" },
			to: {
				path: "^web/src/features/(?!$1/)[^/]+/",
				pathNot: "^web/src/features/[^/]+/public\\.ts$",
			},
		},
		{
			name: "web-app-uses-feature-public-api",
			severity: "error",
			from: { path: "^web/src/app/|^web/src/main\\.tsx$" },
			to: {
				path: "^web/src/features/",
				pathNot: "^web/src/features/[^/]+/(?:public|ui)\\.ts$",
			},
		},
		{
			name: "web-business-does-not-import-ui-entry",
			severity: "error",
			from: {
				path: "^web/src/features/",
				pathNot: "^web/src/features/[^/]+/ui\\.ts$",
			},
			to: { path: "^web/src/features/[^/]+/ui\\.ts$" },
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
