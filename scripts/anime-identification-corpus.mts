import {
	evaluateIdentificationCorpus,
	identificationAuditFailed,
} from "../backend/test/support/anime-identification-corpus.js";
import { loadReportedCorpus } from "../backend/test/support/anime-reported-cases.js";
import { evaluateReportedCorpus } from "../backend/test/support/anime-reported-corpus.js";

const [command = "test", ...arguments_] = process.argv.slice(2);
if (command !== "test" || arguments_.length) {
	console.error(
		JSON.stringify({
			event: "anime_identification.command_rejected",
			usage:
				"npm run anime:identification [-- test]; run anime:corpus for summary or directory generation.",
		}),
	);
	process.exitCode = 2;
} else {
	try {
		console.error(
			JSON.stringify({ event: "anime_identification.started", offline: true }),
		);
		const [identification, reported] = await Promise.all([
			evaluateIdentificationCorpus(),
			loadReportedCorpus().then(evaluateReportedCorpus),
		]);
		const report = {
			event: "anime_identification.evaluated",
			scope:
				"Complete offline path-to-admission audit with controlled candidate pools; not live search recall or persisted confirmation.",
			...identification,
			reported,
		};
		const failed = identificationAuditFailed(report);
		console.log(JSON.stringify({ ...report, failed }, null, 2));
		console.error(
			JSON.stringify({
				event: "anime_identification.completed",
				failed,
				total: identification.summary.total,
				correctAdmissions: identification.summary.correctAdmissions,
				unsafeAdmissions: identification.summary.unsafeAdmissions.length,
				episodeMismatches: identification.summary.episodeMismatches.length,
				missedMatches: identification.summary.missedMatches.length,
				reported: { total: reported.total, passed: reported.passed },
			}),
		);
		if (failed) process.exitCode = 1;
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "anime_identification.failed",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 1;
	}
}
