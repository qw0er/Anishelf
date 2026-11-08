import {
	evaluateRankingCorpus,
	loadRankingCorpus,
} from "../../backend/test/support/anime-ranking-corpus.js";

const [command = "test", ...arguments_] = process.argv.slice(2);
if (arguments_.length || !["test", "summary"].includes(command)) {
	console.error(
		JSON.stringify({
			event: "anime_ranking.command_rejected",
			usage:
				"node --import tsx scripts/manual-tests/anime-ranking-corpus.mts <test|summary>",
		}),
	);
	process.exitCode = 2;
} else {
	try {
		console.error(
			JSON.stringify({
				event: "anime_ranking.started",
				command,
				offline: true,
			}),
		);
		const corpus = await loadRankingCorpus();
		if (command === "summary") {
			console.log(
				JSON.stringify(
					{
						event: "anime_ranking.summary",
						version: corpus.version,
						extractedFrom: corpus.extractedFrom,
						evidenceOrigin: corpus.evidenceOrigin,
						total: corpus.cases.length,
						labelled: corpus.cases.filter(
							(entry) => entry.expected.workId !== null,
						).length,
						pools: corpus.pools.map((pool) => ({
							id: pool.id,
							candidates: pool.works.length,
						})),
					},
					null,
					2,
				),
			);
		} else {
			const report = evaluateRankingCorpus(corpus);
			console.log(JSON.stringify(report, null, 2));
			console.error(
				JSON.stringify({ event: "anime_ranking.completed", ...report.summary }),
			);
			if (report.summary.failed) process.exitCode = 1;
		}
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "anime_ranking.failed",
				command,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 1;
	}
}
