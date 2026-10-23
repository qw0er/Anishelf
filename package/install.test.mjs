import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
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
if(name==='getenforce') console.log(process.env.INSTALL_TEST_SELINUX??'Disabled');
if(name==='uname') console.log('Linux');
if(name==='id') console.log(args[0]==='-un'?'fixture-user':process.env.INSTALL_TEST_UID??'1001');
if(name==='loginctl') console.log('yes');
if(name==='podman'&&args[0]==='compose'&&args[1]==='version'&&process.env.INSTALL_TEST_PROVIDER_FAIL==='yes') process.exit(1);
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
	]) {
		await writeFile(join(bin, name), implementation, { mode: 0o700 });
	}
	for (const name of [
		"bash",
		"cp",
		"mkdir",
		"sed",
		"mv",
		"rm",
		"cat",
		"mktemp",
		"dirname",
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
		if (selected === "podman") values.push(options.method ?? "1");
		values.push(
			options.target ?? target,
			options.media ?? "",
			options.qbit ? "y" : "n",
			options.jackett ? "y" : "n",
			options.advanced === false ? "n" : "y",
		);
		if (options.advanced !== false) {
			values.push(
				options.tag ?? "v0.4.1",
				"127.0.0.1",
				"3300",
				"https://anime.example.com",
			);
			if (options.qbit) values.push("8181", "6991");
			if (options.jackett) values.push("9217");
			if (options.media) values.push(options.relabel ?? "");
		}
		values.push(options.confirm ?? "y");
		return `${values.join("\n")}\n`;
	}
	function run(input = answers(), options = {}) {
		const args = [installer];
		if (options.engine) args.push("--engine", options.engine);
		if (!options.start) args.push("--generate-only");
		if (!options.remote) args.push("--templates-dir", templates);
		return spawnSync("bash", args, {
			input,
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

test("SELinux Compose bind mounts share z, retain backend read-only and never chown host media", async (t) => {
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
			"${ANISHELF_MEDIA_PATH:-anishelf-media}:/data/media:ro,z",
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

test("Quadlet generation preserves namespaces, quotes media paths and synchronizes image/peer ports", async (t) => {
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
		backend.includes(`Volume="${await realpath(media)}:/data/media:ro,z"`),
	);
	assert.match(
		backend,
		/Volume=anishelf-qbittorrent-connection.volume:\/run\/anishelf-qbittorrent:ro,z/,
	);
	assert.ok(qbit.includes(`Volume="${await realpath(media)}:/data/media:z"`));
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
		/\/data\/media:ro,z/,
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
		const env = await readFile(join(f.target, ".env"), "utf8");
		assert.match(env, new RegExp(`ANISHELF_DEPLOY_ENGINE='${engine}'`));
		assert.match(env, /ANISHELF_TAG='latest'/);
		assert.match(env, /ANISHELF_PORT='3000'/);
		assert.match(env, /ANISHELF_PUBLIC_ORIGIN='http:\/\/localhost:3000'/);
	}
});

test("multiple engines prompt for a choice and Podman Compose retains rootless mappings", async (t) => {
	const f = await fixture(t);
	const result = f.run(
		f.answers({ engine: "podman", qbit: true, jackett: true }),
		{ start: true },
	);
	success(result);
	assert.match(result.stderr, /Container engine: 1 Docker, 2 Podman/);
	const config = parse(await readFile(join(f.target, "compose.yaml"), "utf8"));
	for (const service of Object.values(config.services))
		assert.equal(service.userns_mode, "keep-id:uid=1000,gid=1000");
	assert.equal(config.services.qbittorrent.user, "0:0");
	assert.equal(config.services.jackett.user, "0:0");
	const calls = await f.calls();
	assert.ok(
		calls.some((call) => call.name === "podman" && call.args.includes("pull")),
	);
	assert.ok(!calls.some((call) => ["docker", "systemctl"].includes(call.name)));
});

test("missing Podman Compose provider stops without Docker fallback or output files", async (t) => {
	const f = await fixture(t);
	const result = f.run(f.answers({ engine: "podman" }), {
		start: true,
		env: { INSTALL_TEST_PROVIDER_FAIL: "yes" },
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Install its Compose provider/);
	await absent(f.target);
	assert.ok(!(await f.calls()).some((call) => call.name === "docker"));
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
