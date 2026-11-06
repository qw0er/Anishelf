import { readFile } from "node:fs/promises";

async function summary() {
	const root = new URL(
		"../backend/test/fixtures/title-enrichment/",
		import.meta.url,
	);
	const { cases } = JSON.parse(
		await readFile(new URL("cases.json", root), "utf8"),
	);
	const counts = (values) =>
		Object.fromEntries(
			[...new Set(values)]
				.sort()
				.map((key) => [key, values.filter((value) => value === key).length]),
		);
	console.log(
		JSON.stringify(
			{
				event: "title_corpus.summary",
				total: cases.length,
				snapshots: new Set(cases.map((item) => item.snapshot)).size,
				expected: counts(cases.map((item) => item.expected)),
				tags: counts(cases.flatMap((item) => item.tags)),
				note: "Frozen real-source correspondence labels; this summary does not assert that the current algorithm passes positive cases.",
			},
			null,
			2,
		),
	);
}

async function test(split) {
	// Loaded only for an explicit test command; summary never starts the verifier.
	const { testTitleEnrichmentCorpus } = await import(
		"../backend/test/manual/title-enrichment-corpus.js"
	);
	console.error(
		JSON.stringify({
			event: "title_corpus.matcher_test_started",
			offline: true,
		}),
	);
	const report = await testTitleEnrichmentCorpus(split);
	console.log(JSON.stringify(report, null, 2));
	if (report.failed) process.exitCode = 1;
}

const [command = "summary", ...arguments_] = process.argv.slice(2);
const split =
	arguments_[0] === "--split" && arguments_.length === 2
		? arguments_[1]
		: undefined;
if (
	(!split && arguments_.length) ||
	(split &&
		(command !== "test" ||
			!["development", "regression", "holdout"].includes(split))) ||
	!["summary", "test"].includes(command)
) {
	console.error(
		JSON.stringify({
			event: "title_corpus.command_rejected",
			command,
			usage:
				"npm run anime:titles -- <summary|test> [--split development|regression|holdout]",
		}),
	);
	process.exitCode = 2;
} else {
	try {
		if (command === "summary") await summary();
		else await test(split);
	} catch (error) {
		console.error(
			JSON.stringify({
				event:
					command === "test"
						? "title_corpus.matcher_test_failed"
						: "title_corpus.summary_failed",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		process.exitCode = 1;
	}
}
