import {
	evaluateReleaseCorpus,
	loadReleaseCorpus,
} from "../backend/test/support/anime-release-corpus.js";

const [command = "test", ...extra] = process.argv.slice(2);
if (extra.length || !["summary", "test"].includes(command)) {
	console.error(
		JSON.stringify({
			event: "anime_releases.command_rejected",
			usage: "npm run anime:releases -- <summary|test>",
		}),
	);
	process.exitCode = 2;
} else {
	try {
		console.error(
			JSON.stringify({
				event: "anime_releases.started",
				command,
				offline: true,
			}),
		);
		const corpus = await loadReleaseCorpus();
		if (command === "summary")
			console.log(
				JSON.stringify(
					{
						event: "anime_releases.summary",
						version: corpus.version,
						total: corpus.cases.length,
						authentic: corpus.cases.filter(
							(entry) => entry.kind === "authentic",
						).length,
						synthetic: corpus.cases.filter(
							(entry) => entry.kind === "synthetic",
						).length,
					},
					null,
					2,
				),
			);
		else {
			const report = evaluateReleaseCorpus(corpus);
			console.log(JSON.stringify(report, null, 2));
			console.error(
				JSON.stringify({
					event: "anime_releases.completed",
					...report.summary,
				}),
			);
			if (report.summary.failed) process.exitCode = 1;
		}
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "anime_releases.failed",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 1;
	}
}
