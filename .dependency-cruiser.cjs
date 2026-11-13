const modulePath = "apps/server/src/modules/[^/]+/(?:external-works/)?[^/]+/";
const implementation = `${modulePath}(?:(?:application|infrastructure|http)(?:/|\\.ts$)|files\\.ts$)`;
module.exports = {
	forbidden: [
		{
			name: "torrent-clients-implementation-is-private",
			severity: "error",
			from: {
				path: "^apps/server/src/modules/acquisition/(?!torrent-clients/)",
			},
			to: {
				path: "^apps/server/src/modules/acquisition/torrent-clients/",
				pathNot:
					"^apps/server/src/modules/acquisition/torrent-clients/(?:public|create)\\.ts$",
			},
		},
		{
			name: "torrent-clients-do-not-import-business-consumers",
			severity: "error",
			from: { path: "^apps/server/src/modules/acquisition/torrent-clients/" },
			to: {
				path: "^apps/server/src/modules/acquisition/(?:downloads|subscriptions|watching|sources)/|^apps/server/src/modules/(?:anime|resources)/",
			},
		},
		{
			name: "torrent-connection-uses-configuration-port",
			severity: "error",
			from: {
				path: "^apps/server/src/modules/acquisition/torrent-clients/(?:application/|domain/|ports\\.ts$)",
			},
			to: {
				path: "^apps/server/src/modules/acquisition/torrent-clients/qbittorrent/",
			},
		},
		{
			name: "downloads-do-not-import-downloader-adapters",
			severity: "error",
			from: { path: "^apps/server/src/modules/acquisition/downloads/" },
			to: {
				path: "^apps/server/src/modules/acquisition/torrent-clients/qbittorrent/|(?:^|/)node_modules/@ctrl/qbittorrent/",
			},
		},
		{
			name: "sources-implementation-is-private",
			severity: "error",
			from: { path: "^apps/server/src/modules/acquisition/(?!sources/)" },
			to: {
				path: "^apps/server/src/modules/acquisition/sources/",
				pathNot:
					"^apps/server/src/modules/acquisition/sources/(?:public|persistence|create|integration)\\.ts$",
			},
		},
		{
			name: "sources-domain-does-not-import-adapters",
			severity: "error",
			from: {
				path: "^apps/server/src/modules/acquisition/sources/(?:domain/|public\\.ts$|integration\\.ts$|infrastructure/store\\.ts$)",
			},
			to: {
				path: "^apps/server/src/modules/acquisition/sources/(?:rss|jackett)/",
			},
		},
		{
			name: "subscriptions-do-not-import-downloads",
			severity: "error",
			from: { path: "^apps/server/src/modules/acquisition/subscriptions/" },
			to: { path: "^apps/server/src/modules/acquisition/downloads/" },
		},
		{
			name: "acquisition-sources-do-not-import-business-consumers",
			severity: "error",
			from: { path: "^apps/server/src/modules/acquisition/sources/" },
			to: {
				path: "^apps/server/src/modules/acquisition/(?:subscriptions|downloads|watching|torrent-clients)/|^apps/server/src/modules/(?:anime|resources)/",
			},
		},
		{
			name: "download-transfers-do-not-import-business-consumers",
			severity: "error",
			from: {
				path: "^apps/server/src/modules/acquisition/downloads/transfers/",
			},
			to: {
				path: "^apps/server/src/modules/(?:anime|resources)/|^apps/server/src/modules/acquisition/(?:subscriptions)/",
			},
		},
		{
			name: "anime-applications-use-ports",
			severity: "error",
			from: {
				path: "^apps/server/src/modules/anime/(?:external-works/(?:tracking|metadata)|anime-library|anime-catalog|identification)/(?:application/|domain/|ports\\.ts$|public\\.ts$)",
			},
			to: {
				path: "^apps/server/src/modules/anime/(?:external-works/)?(?:[^/]+/infrastructure/|(?:anilist|bangumi)/)",
			},
		},
		{
			name: "provider-protocol-does-not-import-business",
			severity: "error",
			from: {
				path: "^apps/server/src/modules/anime/external-works/(anilist|bangumi)/",
			},
			to: {
				path: "^apps/server/src/modules/anime/(?:external-works/(?!$1/)[^/]+/|(?!(?:external-works)/)[^/]+/)",
			},
		},
		{
			name: "configuration-application-does-not-project-http",
			severity: "error",
			from: {
				path: "^apps/server/src/modules/system/configuration/application/",
			},
			to: { path: "^apps/server/src/contracts/(?:http\\.ts$|schemas/)" },
		},
		{
			name: "no-unresolved-source-imports",
			severity: "error",
			from: { path: "^apps/(?:server|web)/src" },
			to: {
				couldNotResolve: true,
				// Vite resolves this exported npm asset; its query is not a JS module specifier.
				pathNot: "^movi-player/movi\\.wasm\\?url$",
			},
		},
		{
			name: "no-runtime-cycles",
			severity: "error",
			from: { path: "^apps/(?:server|web)/src" },
			to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
		},
		{
			name: "domain-and-ports-do-not-import-http-dtos",
			severity: "error",
			from: {
				path: `^${modulePath}(?:domain/|ports\\.ts$|settings\\.ts$|profile\\.ts$|snapshot\\.ts$|negotiation\\.ts$|result\\.ts$)|^apps/server/src/shared/`,
			},
			to: { path: "^apps/server/src/contracts/(?:http\\.ts$|schemas/)" },
		},
		{
			name: "platform-does-not-import-business",
			severity: "error",
			from: { path: "^apps/server/src/platform/" },
			to: { path: "^apps/server/src/(modules|app|transport)/" },
		},
		{
			name: "shared-does-not-import-business",
			severity: "error",
			from: { path: "^apps/server/src/shared/" },
			to: { path: "^apps/server/src/(modules|app|platform|transport)/" },
		},
		{
			name: "modules-do-not-import-app",
			severity: "error",
			from: { path: `^${modulePath}` },
			to: { path: "^apps/server/src/app/" },
		},
		{
			name: "domain-does-not-import-implementation",
			severity: "error",
			from: { path: `^${modulePath}domain/` },
			to: {
				path: `^${implementation}|^apps/server/src/(app|transport)/|(?:^|/)fastify(?:/|$)`,
			},
		},
		{
			name: "domain-does-not-load-platform-adapters",
			severity: "error",
			from: { path: `^${modulePath}domain/` },
			to: {
				path: "^apps/server/src/platform/",
				pathNot: "(?:policy|config|model|errors)\\.ts$",
				dependencyTypesNot: ["type-only"],
			},
		},
		{
			name: "public-and-policy-do-not-load-implementation",
			severity: "error",
			from: { path: `^${modulePath}(?:public|policy|defaults|ports)\\.ts$` },
			to: { path: `^${implementation}` },
		},
		{
			name: "backend-module-entry-points",
			severity: "error",
			from: {
				path: "^apps/server/src/modules/([^/]+)/(?!integration/|workflows/)([^/]+)/",
			},
			to: {
				path: "^apps/server/src/modules/$1/(?!$2/)[^/]+/",
				pathNot:
					"(?:public|policy|defaults|persistence|create)\\.ts$|^apps/server/src/modules/acquisition/sources/integration\\.ts$",
			},
		},
		{
			name: "large-public-does-not-load-implementation",
			severity: "error",
			from: { path: "^apps/server/src/modules/[^/]+/public\\.ts$" },
			to: {
				path: "^apps/server/src/modules/[^/]+/(?:integration/|workflows/create-[^/]+\\.ts$|create\\.ts$|http\\.ts$|persistence\\.ts$)|^apps/server/src/modules/[^/]+/(?:external-works/)?[^/]+/(?:create\\.ts$|application(?:/|\\.ts$)|infrastructure/|http/)",
			},
		},

		{
			name: "backend-large-module-boundary",
			severity: "error",
			from: { path: "^apps/server/src/modules/([^/]+)/" },
			to: {
				path: "^apps/server/src/modules/(?!$1/)[^/]+/",
				pathNot: "^apps/server/src/modules/[^/]+/(?:public|persistence)\\.ts$",
			},
		},
		{
			name: "backend-app-uses-module-entries",
			severity: "error",
			from: { path: "^apps/server/src/app/" },
			to: {
				path: "^apps/server/src/modules/",
				pathNot:
					"^apps/server/src/modules/[^/]+/(?:public|create|http|persistence)\\.ts$",
			},
		},
		{
			name: "backend-external-consumers-use-public-api",
			severity: "error",
			from: {
				path: "^apps/server/src/",
				pathNot: "^apps/server/src/(app|modules)/",
			},
			to: {
				path: "^apps/server/src/modules/",
				pathNot: "^apps/server/src/modules/[^/]+/public\\.ts$",
			},
		},
		{
			name: "business-does-not-use-assembly-entries",
			severity: "error",
			from: {
				path: "^apps/server/src/modules/",
				pathNot:
					"^apps/server/src/modules/[^/]+/(?:create|http|persistence)\\.ts$|^apps/server/src/modules/[^/]+/(?:integration/|workflows/create-[^/]+\\.ts$|(?:external-works/)?[^/]+/create\\.ts$)",
			},
			to: {
				path: "^apps/server/src/modules/[^/]+/(?:(?:create|http)\\.ts$|(?:external-works/)?[^/]+/create\\.ts$|integration/|workflows/create-[^/]+\\.ts$)",
			},
		},

		{
			name: "http-does-not-call-other-modules",
			severity: "error",
			from: { path: "^apps/server/src/modules/([^/]+/[^/]+)/http/" },
			to: {
				path: "^apps/server/src/modules/(?!$1/)[^/]+/[^/]+/",
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
				path: "^apps/server/src/",
				pathNot:
					"^apps/server/src/app/|^apps/server/src/modules/[^/]+/(?:create|persistence)\\.ts$|^apps/server/src/modules/[^/]+/(?:integration/|workflows/create-[^/]+\\.ts$|(?:external-works/)?[^/]+/create\\.ts$)|^apps/server/src/modules/[^/]+/[^/]+/infrastructure/(?:schema|repository|records)\\.ts$",
			},
			to: {
				path: "^apps/server/src/modules/[^/]+/persistence\\.ts$|^apps/server/src/modules/[^/]+/[^/]+/persistence\\.ts$",
			},
		},

		{
			name: "web-only-imports-browser-contracts",
			severity: "error",
			from: { path: "^apps/web/src/" },
			to: { path: "^apps/server/src/", pathNot: "^apps/server/src/contracts/" },
		},
		{
			name: "web-feature-entry-points",
			severity: "error",
			from: {
				path: "^apps/web/src/features/(resources|media|playback)/([^/]+)/",
			},
			to: {
				path: "^apps/web/src/features/$1/(?!$2/)[^/]+/",
				pathNot: "public\\.ts$",
			},
		},
		{
			name: "web-anime-feature-entry-points",
			severity: "error",
			from: {
				path: "^apps/web/src/features/anime/(catalog|metadata|review|library|tracking)/",
			},
			to: {
				path: "^apps/web/src/features/anime/(?!$1/)(catalog|metadata|review|library|tracking)/",
				pathNot: "public\\.ts$",
			},
		},
		{
			name: "web-anime-catalog-does-not-import-review",
			severity: "error",
			from: { path: "^apps/web/src/features/anime/catalog/" },
			to: { path: "^apps/web/src/features/anime/review/" },
		},
		{
			name: "web-anime-metadata-is-independent",
			severity: "error",
			from: { path: "^apps/web/src/features/anime/metadata/" },
			to: {
				path: "^apps/web/src/features/anime/(catalog|review|library|tracking)/",
			},
		},
		{
			name: "web-anime-shared-is-a-leaf",
			severity: "error",
			from: { path: "^apps/web/src/features/anime/shared/" },
			to: {
				path: "^apps/web/src/features/anime/",
				pathNot: "^apps/web/src/features/anime/shared/",
			},
		},
		{
			name: "web-public-does-not-load-ui-barrels",
			severity: "error",
			from: { path: "^apps/web/src/features/[^/]+/public\\.ts$" },
			to: {
				path: "^apps/web/src/features/.*/ui\\.ts$",
				reachable: true,
			},
		},
		{
			name: "web-large-module-boundary",
			severity: "error",
			from: { path: "^apps/web/src/features/([^/]+)/" },
			to: {
				path: "^apps/web/src/features/(?!$1/)[^/]+/",
				pathNot: "^apps/web/src/features/[^/]+/public\\.ts$",
			},
		},
		{
			name: "web-app-uses-feature-public-api",
			severity: "error",
			from: { path: "^apps/web/src/app/|^apps/web/src/main\\.tsx$" },
			to: {
				path: "^apps/web/src/features/",
				pathNot: "^apps/web/src/features/[^/]+/(?:public|ui)\\.ts$",
			},
		},
		{
			name: "web-business-does-not-import-ui-entry",
			severity: "error",
			from: {
				path: "^apps/web/src/features/",
				pathNot: "^apps/web/src/features/[^/]+/ui\\.ts$",
			},
			to: { path: "^apps/web/src/features/[^/]+/ui\\.ts$" },
		},

		{
			name: "web-shared-does-not-import-features",
			severity: "error",
			from: { path: "^apps/web/src/shared/" },
			to: { path: "^apps/web/src/(features|app)/" },
		},
		{
			name: "web-features-do-not-import-app",
			severity: "error",
			from: { path: "^apps/web/src/features/" },
			to: { path: "^apps/web/src/app/" },
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
