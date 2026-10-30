import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const { parse } = createRequire(
	new URL("../backend/package.json", import.meta.url),
)("yaml");
const installer = new URL("./install.sh", import.meta.url).pathname;
const templates = new URL("./deploy/", import.meta.url).pathname;
const sha = "a".repeat(40);
async function fixture(t, engines = ["docker", "podman"]) {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-install-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const bin = join(directory, "bin"),
		target = join(directory, "deployment"),
		trace = join(directory, "commands.jsonl");
	await mkdir(bin);
	const implementation = `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const name = path.basename(process.argv[1]); const args = process.argv.slice(2);
fs.appendFileSync(process.env.INSTALL_TEST_TRACE, JSON.stringify({name,args,tag:process.env.ANISHELF_TAG??null})+'\\n');
if(name==='mv') {
 if(args[0]==='--version') { console.log('mv (GNU coreutils) fixture'); process.exit(0); }
 if(args[0]==='-T') { fs.renameSync(args.at(-2),args.at(-1)); process.exit(0); }
 const result=require('node:child_process').spawnSync('/bin/mv',args,{stdio:'inherit'}); process.exit(result.status??1);
}
if(name==='getenforce') console.log(process.env.INSTALL_TEST_SELINUX??'Disabled');
if(name==='uname') console.log('Linux');
if(name==='id') console.log(args[0]==='-un'?'fixture-user':process.env.INSTALL_TEST_UID??'1001');
if(name==='loginctl') console.log('yes');
if(name==='podman'&&args[0]==='pull'&&process.env.INSTALL_TEST_PULL_FAIL==='yes') process.exit(1);
if(name==='podman'&&args[0]==='info') console.log(args.at(-1).includes('CgroupsVersion')?'v2':'true');
if(name==='curl') {
 const url=args.find(v=>v.startsWith('http')); const output=args[args.indexOf('-o')+1];
 if(process.env.INSTALL_TEST_FETCH_FAIL==='yes') process.exit(22);
 if(url.includes('/api/health')) process.exit(0);
 if(url.startsWith('https://api.github.com/')) fs.writeFileSync(output,'{\\n  "sha": "${sha}"\\n}');
 else { const file=url.split('/package/deploy/')[1]; if(!url.includes('/${sha}/')) process.exit(23); fs.copyFileSync(path.join(process.env.INSTALL_TEST_TEMPLATES,file),output); }
}
`;
	for (const name of [
		"curl",
		...engines,
		"systemctl",
		"id",
		"uname",
		"getenforce",
		"loginctl",
		"sleep",
		"mv",
	]) {
		await writeFile(join(bin, name), implementation, { mode: 0o700 });
	}
	for (const name of [
		"bash",
		"cp",
		"mkdir",
		"sed",
		"rm",
		"cat",
		"mktemp",
		"dirname",
		"cmp",
	]) {
		const location = spawnSync("/bin/sh", ["-c", `command -v ${name}`], {
			encoding: "utf8",
		}).stdout.trim();
		await symlink(location, join(bin, name));
	}
	const env = {
		...process.env,
		PATH: bin,
		XDG_CONFIG_HOME: join(directory, "config"),
		INSTALL_TEST_TRACE: trace,
		INSTALL_TEST_TEMPLATES: templates,
		INSTALL_TEST_SELINUX: "Disabled",
	};
	function answers(options = {}) {
		const selected =
			options.engine ?? (options.method === "2" ? "podman" : engines[0]);
		const values = [];
		if (engines.length > 1) values.push(selected === "podman" ? "2" : "1");

		values.push(
			options.target ?? target,
			options.media ?? "",
			options.lan ? "y" : "n",
			options.port ?? (options.advanced === false ? "" : "3300"),
			options.qbit ? "y" : "n",
			options.jackett ? "y" : "n",
			options.advanced === false ? "n" : "y",
		);
		if (options.advanced !== false) {
			values.push(
				options.tag ?? "v0.4.1",
				"127.0.0.1",
				"https://anime.example.com",
			);
			if (options.qbit) values.push("8181", "6991");
			if (options.jackett) values.push("9217");
			if (!options.testMode) values.push(options.extra ?? "");
			if (options.media || options.extra) values.push(options.relabel ?? "");
		}
		values.push(options.confirm ?? "y");
		return `${values.join("\n")}\n`;
	}
	function run(input = answers(), options = {}) {
		const args = [installer, ...(options.args ?? [])];
		if (options.engine) args.push("--engine", options.engine);
		if (!options.start) args.push("--generate-only");
		if (!options.remote) args.push("--templates-dir", templates);
		return spawnSync("bash", args, {
			input,
			cwd: options.cwd,
			encoding: "utf8",
			detached: true,
			timeout: 20000,
			env: { ...env, ...options.env },
		});
	}
	async function calls() {
		try {
			return (await readFile(trace, "utf8"))
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
		} catch (error) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
	}
	return { directory, target, env, answers, run, calls };
}
function success(result) {
	assert.equal(result.status, 0, `${result.stderr}\n${result.error ?? ""}`);
}
async function absent(path) {
	await assert.rejects(stat(path), { code: "ENOENT" });
}

test("Compose generation uses the canonical template and invokes no runtime", async (t) => {
	const f = await fixture(t);
	success(f.run());
	assert.equal(
		await readFile(join(f.target, "compose.yaml"), "utf8"),
		await readFile(join(templates, "compose.yaml"), "utf8"),
	);
	const env = await readFile(join(f.target, ".env"), "utf8");
	assert.match(env, /ANISHELF_TAG='v0.4.1'/);
	assert.match(env, /COMPOSE_PROFILES=''/);
	assert.match(env, /ANISHELF_TRUSTED_PROXIES='loopback,uniquelocal'/);
	assert.equal((await stat(join(f.target, ".env"))).mode & 0o777, 0o600);
	assert.deepEqual(
		(await f.calls()).map((call) => call.name),
		["getenforce"],
	);
});

test("additional media paths retain the primary mount in Compose and Quadlet", async (t) => {
	for (const method of ["1", "2"]) {
		const f = await fixture(t);
		const primary = join(f.directory, "primary");
		const first = join(f.directory, "extra one");
		const second = join(f.directory, "extra two");
		await Promise.all([primary, first, second].map((path) => mkdir(path)));
		success(
			f.run(
				f.answers({
					method,
					media: primary,
					extra: `${first}:${second}`,
					relabel: "n",
				}),
			),
		);
		if (method === "1") {
			const compose = parse(
				await readFile(join(f.target, "compose.yaml"), "utf8"),
			);
			assert.equal(
				compose.services.backend.environment.ANISHELF_INITIAL_RESOURCE_ROOTS,
				"/data/media:/data/extra/1:/data/extra/2",
			);
			assert.ok(
				compose.services.backend.volumes.includes(
					`${"$"}{ANISHELF_MEDIA_PATH:-anishelf-media}:/data/media:rw`,
				),
			);
			assert.ok(
				compose.services.backend.volumes.includes(
					`${await realpath(first)}:/data/extra/1:rw`,
				),
			);
			assert.ok(
				compose.services.backend.volumes.includes(
					`${await realpath(second)}:/data/extra/2:rw`,
				),
			);
		} else {
			const backend = await readFile(
				join(f.target, "quadlet/anishelf-backend.container"),
				"utf8",
			);
			assert.ok(
				backend.includes(
					"Environment=ANISHELF_INITIAL_RESOURCE_ROOTS=/data/media:/data/extra/1:/data/extra/2",
				),
			);
			assert.ok(
				backend.includes(`Volume=${await realpath(primary)}:/data/media:rw`),
			);
			assert.ok(
				backend.includes(`Volume=${await realpath(first)}:/data/extra/1:rw`),
			);
			assert.ok(
				backend.includes(`Volume=${await realpath(second)}:/data/extra/2:rw`),
			);
		}
	}
});

const quadletGenerator =
	process.env.ANISHELF_TEST_QUADLET_BIN ??
	[
		"/usr/lib/systemd/system-generators/podman-system-generator",
		"/usr/libexec/podman/quadlet",
	].find(existsSync);

test("real Quadlet generation passes media mounts without literal quotes", {
	skip: !quadletGenerator,
}, async (t) => {
	for (const selinux of ["Disabled", "Enforcing"]) {
		const f = await fixture(t);
		const media = join(f.directory, "media");
		const extra = join(f.directory, "动画 media files");
		const runtime = join(f.directory, "runtime");
		await Promise.all([media, extra, runtime].map((path) => mkdir(path)));
		success(
			f.run(f.answers({ method: "2", media, extra, qbit: true }), {
				env: { INSTALL_TEST_SELINUX: selinux },
			}),
		);
		const generated = spawnSync(quadletGenerator, ["--user", "--dryrun"], {
			encoding: "utf8",
			timeout: 20000,
			env: {
				...process.env,
				QUADLET_UNIT_DIRS: join(f.target, "quadlet"),
				XDG_RUNTIME_DIR: runtime,
			},
		});
		success(generated);
		const output = generated.stdout.replaceAll("\\x20", " ");
		const backend = output
			.split("---anishelf-backend.service---")[1]
			?.split("---")[0];
		const qbit = output
			.split("---anishelf-qbittorrent.service---")[1]
			?.split("---")[0];
		assert.ok(backend, generated.stdout + generated.stderr);
		assert.ok(qbit, generated.stdout + generated.stderr);
		const label = selinux === "Enforcing" ? ",z" : "";
		assert.ok(
			backend.includes(`-v ${await realpath(media)}:/data/media:rw${label} `),
		);
		assert.ok(
			backend.includes(
				`-v "${await realpath(extra)}:/data/extra/1:rw${label}" `,
			),
		);
		assert.ok(
			qbit.includes(
				`-v ${await realpath(media)}:/data/media${label ? ":z" : ""} `,
			),
		);
	}
});

test("SELinux Compose bind mounts share z, grant backend media writes and never chown host media", async (t) => {
	const f = await fixture(t),
		media = join(f.directory, "动画 media");
	await mkdir(media);
	success(
		f.run(f.answers({ media, qbit: true, jackett: true }), {
			env: { INSTALL_TEST_SELINUX: "Enforcing" },
		}),
	);
	const yaml = await readFile(join(f.target, "compose.yaml"), "utf8"),
		config = parse(yaml);
	assert.ok(
		config.services.backend.volumes.includes(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: assert literal Compose interpolation syntax
			"${ANISHELF_MEDIA_PATH:-anishelf-media}:/data/media:rw,z",
		),
	);
	assert.ok(
		config.services.qbittorrent.volumes.includes(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: assert literal Compose interpolation syntax
			"${ANISHELF_MEDIA_PATH:-anishelf-media}:/data/media:z",
		),
	);
	assert.doesNotMatch(
		config.services.qbittorrent.entrypoint.at(-1),
		/chown.*\/data\/media/,
	);
	assert.match(
		config.services.qbittorrent.entrypoint.at(-1),
		/chown.*\/data\/incomplete/,
	);
	assert.match(
		await readFile(join(f.target, ".env"), "utf8"),
		/COMPOSE_PROFILES='qbittorrent,jackett'/,
	);
});

test("Quadlet generation preserves namespaces, literal media paths and synchronizes image/peer ports", async (t) => {
	const f = await fixture(t),
		media = join(f.directory, "media files");
	await mkdir(media);
	success(
		f.run(f.answers({ method: "2", media, qbit: true, jackett: true }), {
			env: { INSTALL_TEST_SELINUX: "Enforcing" },
		}),
	);
	const file = (name) => readFile(join(f.target, "quadlet", name), "utf8");
	const backend = await file("anishelf-backend.container"),
		qbit = await file("anishelf-qbittorrent.container");
	assert.match(
		await file("anishelf-web.container"),
		/Environment=ANISHELF_PUBLIC_ORIGIN=https:\/\/anime.example.com/,
	);
	assert.match(
		backend,
		/Environment=ANISHELF_TRUSTED_PROXIES=loopback,uniquelocal/,
	);
	assert.match(backend, /Image=ghcr.io\/qw0er\/anishelf-backend:v0.4.1/);
	assert.ok(
		backend.includes(`Volume=${await realpath(media)}:/data/media:rw,z`),
	);
	assert.match(
		backend,
		/Volume=anishelf-qbittorrent-connection.volume:\/run\/anishelf-qbittorrent:ro,z/,
	);
	assert.ok(qbit.includes(`Volume=${await realpath(media)}:/data/media:z`));
	assert.match(qbit, /UserNS=keep-id:uid=1000,gid=1000/);
	assert.match(qbit, /TORRENTING_PORT=6991/);
	assert.match(qbit, /PublishPort=6991:6991\/udp/);
	assert.match(qbit, /PublishPort=127.0.0.1:8181:8080/);
	assert.doesNotMatch(qbit, /chown[^;]+\/data\/media/);
	assert.match(
		await file("anishelf-web.container"),
		/PublishPort=127.0.0.1:3300:8080/,
	);
	assert.match(
		await file("anishelf-jackett.container"),
		/PublishPort=127.0.0.1:9217:9117/,
	);
	assert.match(
		await file("anishelf-jackett.container"),
		/Requires=anishelf-jackett-init.service/,
	);
	assert.match(
		await file("anishelf-jackett-init.container"),
		/Exec=node \/app\/package\/jackett-init.mjs/,
	);
	await absent(join(f.env.XDG_CONFIG_HOME, "containers"));
});

test("remote templates resolve one GitHub commit before any asset request", async (t) => {
	const f = await fixture(t);
	success(f.run(f.answers(), { remote: true }));
	const urls = (await f.calls())
		.filter((call) => call.name === "curl")
		.flatMap((call) => call.args.filter((arg) => arg.startsWith("https://")));
	assert.deepEqual(urls, [
		"https://api.github.com/repos/qw0er/Anishelf/commits/main",
		`https://raw.githubusercontent.com/qw0er/Anishelf/${sha}/package/deploy/compose.yaml`,
	]);
	assert.match(
		await readFile(join(f.target, "install.log"), "utf8"),
		new RegExp(sha),
	);
});

test("cancellation and download failure leave no deployment", async (t) => {
	const f = await fixture(t);
	success(f.run(f.answers({ confirm: "n" })));
	await absent(f.target);
	assert.equal(
		f.run(f.answers(), {
			remote: true,
			env: { INSTALL_TEST_FETCH_FAIL: "yes" },
		}).status,
		1,
	);
	await absent(f.target);
});

test("existing directories and control/shell syntax inputs are rejected without overwrites", async (t) => {
	const f = await fixture(t);
	await mkdir(f.target);
	await writeFile(join(f.target, ".env"), "preserve me");
	assert.equal(f.run(`1\n${f.target}\n`).status, 1);
	assert.equal(await readFile(join(f.target, ".env"), "utf8"), "preserve me");
	assert.equal(f.run(`1\n${f.directory}/$(touch owned)\n`).status, 1);
	await absent(join(f.directory, "owned"));
});

test("SELinux refuses system-directory relabeling and honors manual prelabel opt-out", async (t) => {
	const f = await fixture(t);
	const refused = f.run(f.answers({ media: "/etc" }), {
		env: { INSTALL_TEST_SELINUX: "Enforcing" },
	});
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /Refusing to relabel/);
	await absent(f.target);
	const media = join(f.directory, "prelabeled");
	await mkdir(media);
	success(
		f.run(f.answers({ media, relabel: "n" }), {
			env: { INSTALL_TEST_SELINUX: "Enforcing" },
		}),
	);
	assert.doesNotMatch(
		await readFile(join(f.target, "compose.yaml"), "utf8"),
		/\/data\/media:rw,z/,
	);
});

test("Compose startup validates, pulls, starts and checks health without inherited configuration overrides", async (t) => {
	const f = await fixture(t);
	success(
		f.run(f.answers(), {
			start: true,
			env: { ANISHELF_TAG: "wrong-inherited-tag" },
		}),
	);
	const calls = await f.calls(),
		compose = calls.filter(
			(call) => call.name === "docker" && call.args[0] === "compose",
		);
	assert.deepEqual(
		compose.slice(1).map((call) => call.args.slice(-1)[0]),
		["--quiet", "pull", "-d"],
	);
	assert.ok(compose.slice(1).every((call) => call.tag === null));
	assert.ok(
		calls.some(
			(call) =>
				call.name === "curl" &&
				call.args.includes("http://127.0.0.1:3300/api/health"),
		),
	);
});

test("Quadlet startup installs target separately, enables only the target and preserves existing units", async (t) => {
	const f = await fixture(t);
	success(f.run(f.answers({ method: "2" }), { start: true }));
	const units = join(f.env.XDG_CONFIG_HOME, "containers/systemd");
	assert.match(
		await readFile(join(units, "anishelf-backend.container"), "utf8"),
		/Image=/,
	);
	await absent(join(units, "anishelf.target"));
	assert.match(
		await readFile(
			join(f.env.XDG_CONFIG_HOME, "systemd/user/anishelf.target"),
			"utf8",
		),
		/WantedBy=default.target/,
	);
	const commands = (await f.calls()).filter(
		(call) => call.name === "systemctl",
	);
	assert.ok(
		commands.some(
			(call) => call.args.join(" ") === "--user enable --now anishelf.target",
		),
	);
	const other = join(f.directory, "other");
	const rejected = f.run(f.answers({ method: "2", target: other }), {
		start: true,
	});
	assert.equal(rejected.status, 1);
	assert.match(rejected.stderr, /Existing Anishelf unit/);
	await absent(other);
});

test("invalid/colliding ports and rootful Quadlet fail before configuration is written", async (t) => {
	const f = await fixture(t);
	const collision = f
		.answers({ qbit: true })
		.replace("8181\n6991", "3300\n6991");
	const invalid = f.run(collision);
	assert.equal(invalid.status, 1);
	assert.match(invalid.stderr, /TCP ports must be distinct/);
	await absent(f.target);
	const root = f.run(f.answers({ method: "2" }), {
		start: true,
		env: { INSTALL_TEST_UID: "0" },
	});
	assert.equal(root.status, 1);
	assert.match(root.stderr, /non-root service user/);
	await absent(f.target);
});

test("single engines are selected automatically and defaults skip advanced questions", async (t) => {
	for (const engine of ["docker", "podman"]) {
		const f = await fixture(t, [engine]);
		const result = f.run(f.answers({ advanced: false }));
		success(result);
		assert.match(
			result.stderr,
			new RegExp(`Detected ${engine}; using it automatically`),
		);
		assert.doesNotMatch(
			result.stderr,
			/Container engine:|Matching Anishelf Web\/Backend image tag|Application bind IPv4 address/,
		);
		if (engine === "docker") {
			const env = await readFile(join(f.target, ".env"), "utf8");
			assert.match(env, /ANISHELF_PORT='3000'/);
			assert.match(env, /ANISHELF_PUBLIC_ORIGIN=''/);
		} else {
			await absent(join(f.target, "compose.yaml"));
			assert.match(
				await readFile(
					join(f.target, "quadlet/anishelf-web.container"),
					"utf8",
				),
				/PublishPort=127.0.0.1:3000:8080/,
			);
		}
	}
});

test("Podman selects Quadlet without invoking a Compose provider", async (t) => {
	const f = await fixture(t);
	const result = f.run(
		f.answers({ engine: "podman", qbit: true, jackett: true }),
		{ start: true },
	);
	success(result);
	assert.match(result.stderr, /Podman selected; using rootless Quadlet/);
	await absent(join(f.target, "compose.yaml"));
	const calls = await f.calls();
	assert.ok(calls.some((call) => call.name === "systemctl"));
	assert.ok(
		!calls.some((call) => call.name === "docker" || call.args[0] === "compose"),
	);
});

test("legacy Podman Compose bundles are rejected without changing services or files", async (t) => {
	const f = await fixture(t, ["docker"]);
	success(f.run(f.answers({ advanced: false })));
	const envFile = join(f.target, ".env");
	const env = (await readFile(envFile, "utf8")).replace(
		"ANISHELF_DEPLOY_ENGINE='docker'",
		"ANISHELF_DEPLOY_ENGINE='podman'",
	);
	await writeFile(envFile, env);
	const before = (await f.calls()).length;
	for (const action of ["--remove", "--reconfigure"]) {
		const result = f.run("y\n", { start: true, args: [action, f.target] });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Podman Compose is no longer supported/);
	}
	assert.equal(await readFile(envFile, "utf8"), env);
	assert.equal((await f.calls()).length, before);
});

test("no detected engine fails clearly while explicit engine permits offline generation", async (t) => {
	const f = await fixture(t, []);
	const missing = f.run("");
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /Install Docker or Podman first/);
	await absent(f.target);
	success(
		f.run(f.answers({ engine: "docker", advanced: false }), {
			engine: "docker",
		}),
	);
});

test("removing a saved Compose configuration archives it and never removes volumes or unrelated files", async (t) => {
	const f = await fixture(t, ["docker"]);
	success(f.run(f.answers({ advanced: false })));
	const original = await readFile(join(f.target, "compose.yaml"), "utf8");
	await writeFile(join(f.target, "keep.txt"), "user data");
	success(f.run("y\n", { start: true, args: ["--remove", f.target] }));
	await absent(join(f.target, "compose.yaml"));
	await absent(join(f.target, ".env"));
	await absent(f.target);
	const { readdir } = await import("node:fs/promises");
	const backup = (await readdir(f.directory)).find((name) =>
		name.startsWith("deployment.backup."),
	);
	assert.equal(
		await readFile(join(f.directory, backup, "compose.yaml"), "utf8"),
		original,
	);
	assert.equal(
		await readFile(join(f.directory, backup, "keep.txt"), "utf8"),
		"user data",
	);
	const down = (await f.calls()).find((call) => call.args.includes("down"));
	assert.ok(down);
	assert.ok(!down.args.includes("--volumes") && !down.args.includes("-v"));
});

test("removal cancellation and unrecognized bundles leave existing files intact", async (t) => {
	const f = await fixture(t, ["docker"]);
	success(f.run(f.answers({ advanced: false })));
	success(f.run("n\n", { start: true, args: ["--remove", f.target] }));
	assert.ok((await stat(join(f.target, "compose.yaml"))).isFile());
	assert.ok(!(await f.calls()).some((call) => call.args.includes("down")));
	await writeFile(join(f.target, ".env"), "COMPOSE_PROJECT_NAME=other\n");
	assert.notEqual(
		f.run("y\n", { start: true, args: ["--remove", f.target] }).status,
		0,
	);
	assert.ok((await stat(join(f.target, "compose.yaml"))).isFile());
});

test("reconfiguration renders before removal and starts a replacement with the same engine and volumes", async (t) => {
	const f = await fixture(t, ["docker"]);
	success(f.run(f.answers({ advanced: false })));
	await writeFile(join(f.target, "custom.txt"), "old configuration notes");
	// Reconfiguration retains the directory and engine, then collects fresh settings.
	const result = f.run("\nn\n\ny\ny\nn\ny\n", {
		start: true,
		args: ["--reconfigure", f.target],
	});
	success(result);
	const env = await readFile(join(f.target, ".env"), "utf8");
	assert.match(env, /COMPOSE_PROFILES='qbittorrent,jackett'/);
	await absent(join(f.target, "custom.txt"));
	const { readdir } = await import("node:fs/promises");
	const backup = (await readdir(f.directory)).find((name) =>
		name.startsWith("deployment.backup."),
	);
	assert.equal(
		await readFile(join(f.directory, backup, "custom.txt"), "utf8"),
		"old configuration notes",
	);
	const calls = await f.calls();
	const down = calls.findIndex((call) => call.args.includes("down"));
	const up = calls.findIndex((call) => call.args.includes("up"));
	assert.ok(down >= 0 && up > down);
	assert.ok(calls.slice(0, down).some((call) => call.args.includes("config")));
	assert.ok(
		!calls.some(
			(call) => call.args.includes("--volumes") || call.args.includes("volume"),
		),
	);
});

test("failed replacement template download leaves the current deployment running", async (t) => {
	const f = await fixture(t, ["docker"]);
	success(f.run(f.answers({ advanced: false })));
	const original = await readFile(join(f.target, "compose.yaml"), "utf8");
	const result = f.run("\nn\n\nn\nn\nn\ny\n", {
		start: true,
		remote: true,
		args: ["--reconfigure", f.target],
		env: { INSTALL_TEST_FETCH_FAIL: "yes" },
	});
	assert.notEqual(result.status, 0);
	assert.equal(
		await readFile(join(f.target, "compose.yaml"), "utf8"),
		original,
	);
	assert.ok(!(await f.calls()).some((call) => call.args.includes("down")));
});

test("Quadlet removal stops matching services, removes installed units and retains unrelated units", async (t) => {
	const f = await fixture(t, ["podman"]);
	success(
		f.run(
			f.answers({ method: "2", qbit: true, jackett: true, advanced: false }),
			{ start: true },
		),
	);
	const unitDir = join(f.env.XDG_CONFIG_HOME, "containers/systemd");
	await writeFile(join(unitDir, "unrelated.container"), "user service");
	success(f.run("y\n", { start: true, args: ["--remove", f.target] }));
	await absent(join(unitDir, "anishelf-backend.container"));
	await absent(f.target);
	const { readdir } = await import("node:fs/promises");
	const backup = (await readdir(f.directory)).find((name) =>
		name.startsWith("deployment.backup."),
	);
	assert.ok(
		(
			await stat(
				join(f.directory, backup, "quadlet/anishelf-backend.container"),
			)
		).isFile(),
	);
	await absent(join(f.env.XDG_CONFIG_HOME, "systemd/user/anishelf.target"));
	assert.equal(
		await readFile(join(unitDir, "unrelated.container"), "utf8"),
		"user service",
	);
	const calls = await f.calls();
	assert.ok(
		calls.some(
			(call) =>
				call.args.includes("stop") &&
				call.args.includes("anishelf-jackett.service"),
		),
	);
	assert.ok(
		!calls.some((call) => call.name === "podman" && call.args.includes("rm")),
	);
});

test("Quadlet reconfiguration preserves its method and refuses changed installed units", async (t) => {
	const f = await fixture(t, ["podman"]);
	success(
		f.run(f.answers({ method: "2", qbit: true, advanced: false }), {
			start: true,
		}),
	);
	success(
		f.run("\nn\n\nn\ny\nn\ny\n", {
			start: true,
			args: ["--reconfigure", f.target],
		}),
	);
	const unitDir = join(f.env.XDG_CONFIG_HOME, "containers/systemd");
	await absent(join(unitDir, "anishelf-qbittorrent.container"));
	assert.ok((await stat(join(unitDir, "anishelf-jackett.container"))).isFile());
	await writeFile(join(unitDir, "anishelf-backend.container"), "local edits");
	const before = (await f.calls()).length;
	assert.notEqual(
		f.run("y\n", { start: true, args: ["--remove", f.target] }).status,
		0,
	);
	assert.equal(
		await readFile(join(unitDir, "anishelf-backend.container"), "utf8"),
		"local edits",
	);
	assert.ok(
		!(await f.calls()).slice(before).some((call) => call.args.includes("stop")),
	);
});

test("force backs up changed Quadlet units during reconfiguration and removal", async (t) => {
	const f = await fixture(t, ["podman"]);
	success(f.run(f.answers({ method: "2", advanced: false }), { start: true }));
	const unit = join(
		f.env.XDG_CONFIG_HOME,
		"containers/systemd/anishelf-backend.container",
	);
	await writeFile(unit, "user configuration before reconfigure");
	success(
		f.run("\nn\n\nn\nn\nn\ny\n", {
			start: true,
			args: ["--force", "--reconfigure", f.target],
		}),
	);
	let backups = (await readdir(f.directory)).filter((name) =>
		name.startsWith("deployment.quadlet-backup."),
	);
	assert.equal(backups.length, 1);
	assert.equal(
		await readFile(
			join(f.directory, backups[0], "anishelf-backend.container"),
			"utf8",
		),
		"user configuration before reconfigure",
	);
	await writeFile(unit, "user configuration before removal");
	success(
		f.run("y\n", { start: true, args: ["--force", "--remove", f.target] }),
	);
	backups = (await readdir(f.directory)).filter((name) =>
		name.startsWith("deployment.quadlet-backup."),
	);
	assert.equal(backups.length, 2);
	const contents = await Promise.all(
		backups.map((name) =>
			readFile(join(f.directory, name, "anishelf-backend.container"), "utf8"),
		),
	);
	assert.ok(contents.includes("user configuration before removal"));
});

test("force backs up an existing Quadlet unit during installation", async (t) => {
	const f = await fixture(t, ["podman"]);
	const unitDir = join(f.env.XDG_CONFIG_HOME, "containers/systemd");
	await mkdir(unitDir, { recursive: true });
	const unit = join(unitDir, "anishelf-backend.container");
	await writeFile(unit, "existing configuration");
	const rejected = f.run(f.answers({ method: "2", advanced: false }), {
		start: true,
	});
	assert.notEqual(rejected.status, 0);
	assert.equal(await readFile(unit, "utf8"), "existing configuration");
	success(
		f.run(f.answers({ method: "2", advanced: false }), {
			start: true,
			args: ["--force"],
		}),
	);
	const backup = (await readdir(f.directory)).find((name) =>
		name.startsWith("deployment.quadlet-backup."),
	);
	assert.ok(backup);
	assert.equal(
		await readFile(
			join(f.directory, backup, "anishelf-backend.container"),
			"utf8",
		),
		"existing configuration",
	);
});

test("installer resolves relative deployment and media paths from the working directory", async (t) => {
	const f = await fixture(t, ["docker"]);
	await mkdir(join(f.directory, "media"));
	await mkdir(join(f.directory, "extra"));
	success(
		f.run(
			f.answers({
				target: "deployment",
				media: "media",
				extra: "extra",
				relabel: "n",
			}),
			{ cwd: f.directory },
		),
	);
	const env = await readFile(join(f.target, ".env"), "utf8");
	assert.ok(
		env.includes(
			`ANISHELF_MEDIA_PATH='${await realpath(join(f.directory, "media"))}'`,
		),
	);
	const compose = parse(await readFile(join(f.target, "compose.yaml"), "utf8"));
	assert.ok(
		compose.services.backend.volumes.includes(
			`${await realpath(join(f.directory, "extra"))}:/data/extra/1:rw`,
		),
	);
	success(
		f.run("y\n", {
			cwd: f.directory,
			start: true,
			args: ["--remove", "deployment"],
		}),
	);
});

test("reconfiguration rejects unrelated Anishelf units before stopping services", async (t) => {
	const f = await fixture(t, ["podman"]);
	success(f.run(f.answers({ method: "2", advanced: false }), { start: true }));
	const path = join(
		f.env.XDG_CONFIG_HOME,
		"containers/systemd/anishelf-custom.container",
	);
	await writeFile(path, "custom service");
	const before = (await f.calls()).length;
	const result = f.run("\nn\n\nn\nn\nn\ny\n", {
		start: true,
		args: ["--reconfigure", f.target],
	});
	assert.notEqual(result.status, 0);
	assert.ok(
		!(await f.calls()).slice(before).some((call) => call.args.includes("stop")),
	);
	assert.equal(await readFile(path, "utf8"), "custom service");
});

test("Quadlet explicitly pulls every selected image once before installing or replacing units", async (t) => {
	const f = await fixture(t, ["podman"]);
	success(
		f.run(
			f.answers({ method: "2", qbit: true, jackett: true, advanced: false }),
			{ start: true },
		),
	);
	const calls = await f.calls();
	const pulls = calls.filter(
		(call) => call.name === "podman" && call.args[0] === "pull",
	);
	assert.deepEqual(
		pulls.map((call) => call.args[1]).sort(),
		[
			"ghcr.io/qw0er/anishelf-backend:latest",
			"ghcr.io/qw0er/anishelf-web:latest",
			"docker.io/linuxserver/qbittorrent:latest",
			"ghcr.io/linuxserver/jackett:latest",
		].sort(),
	);
	const start = calls.findIndex((call) => call.args.includes("enable"));
	assert.ok(pulls.every((call) => calls.indexOf(call) < start));
	const before = calls.length;
	const failed = f.run("\nn\n\nn\nn\nn\ny\n", {
		start: true,
		args: ["--reconfigure", f.target],
		env: { INSTALL_TEST_PULL_FAIL: "yes" },
	});
	assert.notEqual(failed.status, 0);
	assert.ok(
		!(await f.calls()).slice(before).some((call) => call.args.includes("stop")),
	);
	assert.ok(
		(await stat(join(f.target, "quadlet/anishelf-backend.container"))).isFile(),
	);
});

test("Testing Compose isolates all volumes and retains its identity during removal", async (t) => {
	const f = await fixture(t, ["docker"]);
	success(
		f.run(`${f.target}\n\nn\nn\nn\ny\n`, { args: ["--test"], start: true }),
	);
	const config = parse(await readFile(join(f.target, "compose.yaml"), "utf8"));
	for (const volume of Object.values(config.volumes)) {
		assert.ok(volume.name.startsWith("anishelf-test-"));
	}
	const env = await readFile(join(f.target, ".env"), "utf8");
	assert.match(env, /ANISHELF_TAG='testing'/);
	assert.match(env, /ANISHELF_PORT='3001'/);
	assert.match(env, /ANISHELF_MEDIA_PATH=''/);
	assert.match(env, /COMPOSE_PROJECT_NAME='anishelf-test'/);
	success(
		f.run("\nn\nn\nn\ny\n", { args: ["--reconfigure", f.target], start: true }),
	);
	assert.equal(
		await readFile(join(f.target, ".deployment-profile"), "utf8"),
		"testing\n",
	);
	success(f.run("y\n", { args: ["--remove", f.target], start: true }));
	const composeCalls = (await f.calls()).filter(
		(call) =>
			call.args[0] === "compose" && call.args.includes("--project-name"),
	);
	assert.ok(composeCalls.some((call) => call.args.includes("down")));
	assert.ok(
		composeCalls.every(
			(call) =>
				call.args[call.args.indexOf("--project-name") + 1] === "anishelf-test",
		),
	);
});

test("Testing Quadlet coexists with production and removes only testing units", async (t) => {
	const f = await fixture(t, ["podman"]);
	const units = join(f.env.XDG_CONFIG_HOME, "containers/systemd");
	const userUnits = join(f.env.XDG_CONFIG_HOME, "systemd/user");
	await mkdir(units, { recursive: true });
	await mkdir(userUnits, { recursive: true });
	await writeFile(
		join(units, "anishelf-backend.container"),
		"production backend",
	);
	await writeFile(join(userUnits, "anishelf.target"), "production target");
	success(
		f.run(`${f.target}\n\ny\ny\nn\ny\n`, { args: ["--test"], start: true }),
	);
	const backend = await readFile(
		join(units, "anishelf-test-backend.container"),
		"utf8",
	);
	assert.match(backend, /Image=ghcr.io\/qw0er\/anishelf-backend:testing/);
	assert.match(backend, /Volume=anishelf-test-app.volume:/);
	assert.match(backend, /Network=anishelf-test.network/);
	assert.equal(
		await readFile(join(units, "anishelf-test.network"), "utf8"),
		"[Network]\nNetworkName=anishelf-test\n",
	);
	assert.match(
		await readFile(join(units, "anishelf-test-web.container"), "utf8"),
		/PublishPort=127.0.0.1:3001:8080/,
	);
	assert.match(
		await readFile(join(units, "anishelf-test-qbittorrent.container"), "utf8"),
		/PublishPort=127.0.0.1:8081:8080/,
	);

	success(
		f.run("\nn\nn\nn\ny\n", { args: ["--reconfigure", f.target], start: true }),
	);
	assert.equal(
		await readFile(join(f.target, ".deployment-profile"), "utf8"),
		"testing\n",
	);
	success(f.run("y\n", { args: ["--remove", f.target], start: true }));
	await absent(join(units, "anishelf-test-backend.container"));
	assert.equal(
		await readFile(join(units, "anishelf-backend.container"), "utf8"),
		"production backend",
	);
	assert.equal(
		await readFile(join(userUnits, "anishelf.target"), "utf8"),
		"production target",
	);
	assert.ok(
		!(await f.calls()).some(
			(call) =>
				call.args.includes("stop") && call.args.includes("anishelf.target"),
		),
	);
});

test("Compose templates retain optional flat origin defaults", async () => {
	for (const template of [
		new URL("../compose.yaml", import.meta.url),
		new URL("./deploy/compose.yaml", import.meta.url),
	]) {
		const yaml = await readFile(template, "utf8");
		assert.doesNotMatch(yaml, /\$\{[^}]*\$\{/);
		const config = parse(yaml);
		for (const service of ["backend"]) {
			assert.equal(
				config.services[service].environment.ANISHELF_PUBLIC_ORIGIN,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: literal Compose configuration
				"${ANISHELF_PUBLIC_ORIGIN:-}",
			);
		}
	}
});

test("Docker Compose activates only saved optional service profiles", async (t) => {
	for (const selection of [
		{ qbit: false, jackett: false },
		{ qbit: true, jackett: false },
		{ qbit: false, jackett: true },
		{ qbit: true, jackett: true },
	]) {
		const f = await fixture(t, ["docker"]);
		const result = f.run(f.answers({ ...selection, advanced: false }), {
			start: true,
			env: { COMPOSE_PROFILES: "unwanted-inherited-profile" },
		});
		success(result);
		const calls = (await f.calls()).filter(
			(call) =>
				call.args[0] === "compose" && call.args.includes("--project-name"),
		);
		assert.ok(calls.some((call) => call.args.includes("pull")));
		assert.ok(calls.some((call) => call.args.includes("up")));
		for (const call of calls) {
			const profiles = call.args.filter(
				(_, index) => call.args[index - 1] === "--profile",
			);
			assert.deepEqual(profiles.sort(), [
				...(selection.jackett ? ["jackett"] : []),
				...(selection.qbit ? ["qbittorrent"] : []),
			]);
		}
		assert.doesNotMatch(result.stderr, /--project-directory/);
		assert.match(
			result.stderr,
			/Read the initial password with: .*--env-file .* -f .* logs backend/,
		);
	}
});

test("LAN installation exposes the chosen port without requiring an origin", async (t) => {
	const f = await fixture(t, ["docker"]);
	success(f.run(f.answers({ advanced: false, lan: true, port: "8787" })));
	const env = await readFile(join(f.target, ".env"), "utf8");
	assert.match(env, /ANISHELF_BIND_ADDRESS='0.0.0.0'/);
	assert.match(env, /ANISHELF_PORT='8787'/);
	assert.match(env, /ANISHELF_PUBLIC_ORIGIN=''/);
});
