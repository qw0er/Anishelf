import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { QbittorrentConnectionSettings } from "../../shared/api/contracts.js";
import { boundedSignal } from "../../shared/api/queries.js";
import { Button } from "../../shared/components/ui/button.js";
import { Input } from "../../shared/components/ui/input.js";
import { toast } from "../../shared/components/ui/toast.js";
import {
	checkQbittorrentConnection,
	clearQbittorrentConnection,
	getQbittorrentConnection,
	getQbittorrentCredentials,
	saveQbittorrentConnection,
} from "./api.js";
import { downloadKeys } from "./downloads-api.js";

const queryKey = ["acquisition", "qbittorrent"] as const;

export function QbittorrentApiSettings() {
	const query = useQuery({
		queryKey,
		queryFn: ({ signal }) =>
			getQbittorrentConnection({ signal: boundedSignal(signal) }),
	});
	return (
		<section
			className="space-y-3 border-b pb-4"
			aria-label="qBittorrent API connection"
		>
			<h3 className="text-sm font-medium">API connection</h3>
			{query.isPending ? (
				<p role="status">Loading API connection…</p>
			) : query.isError ? (
				<div role="alert">
					Could not load API settings.{" "}
					<Button variant="outline" onClick={() => void query.refetch()}>
						Retry API settings
					</Button>
				</div>
			) : (
				<ConnectionForm key={query.data.generation} settings={query.data} />
			)}
		</section>
	);
}

function ConnectionForm({
	settings,
}: {
	settings: QbittorrentConnectionSettings;
}) {
	const client = useQueryClient();
	const [url, setUrl] = useState(settings.url ?? "");
	const [username, setUsername] = useState(settings.username);
	const [password, setPassword] = useState("");
	const [editing, setEditing] = useState(!settings.bundled);
	const [revealed, setRevealed] = useState<string | null>(null);
	const [revealing, setRevealing] = useState(false);
	useEffect(() => {
		if (revealed === null) return;
		const timer = setTimeout(() => setRevealed(null), 30_000);
		const hide = () => {
			if (document.hidden) setRevealed(null);
		};
		document.addEventListener("visibilitychange", hide);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", hide);
		};
	}, [revealed]);
	async function reveal() {
		setRevealing(true);
		try {
			const value = await getQbittorrentCredentials(settings.generation);
			setRevealed(value.password);
		} catch {
			toast.add({
				title: "Could not load WebUI credentials. Reload settings and retry.",
				type: "error",
			});
		} finally {
			setRevealing(false);
		}
	}
	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			toast.add({ title: "Copied.", type: "success" });
		} catch {
			toast.add({
				title: "Could not copy. Select and copy the displayed value.",
				type: "error",
			});
		}
	}
	const changed =
		url !== (settings.url ?? "") ||
		username !== settings.username ||
		Boolean(password);
	const sameAccount = url === settings.url && username === settings.username;
	function saved(value: QbittorrentConnectionSettings) {
		setPassword("");
		client.setQueryData(queryKey, value);
		void client.invalidateQueries({ queryKey: downloadKeys });
	}
	const save = useMutation({
		// Passwords stay out of mutation variables and query caches.
		mutationFn: () =>
			saveQbittorrentConnection({
				generation: settings.generation,
				url,
				username,
				...(password ? { password } : {}),
			}),
		onSuccess: (value) => {
			saved(value);
			toast.add({
				title: "qBittorrent API connection saved.",
				type: "success",
			});
		},
		onError: () => {
			toast.add({
				title:
					"Could not save API settings. Reload if another session changed them.",
				type: "error",
			});
		},
	});
	const clear = useMutation({
		mutationFn: () => clearQbittorrentConnection(settings.generation),
		onSuccess: (value) => {
			saved(value);
			toast.add({
				title: "qBittorrent API connection removed.",
				type: "success",
			});
		},
		onError: () => {
			toast.add({
				title:
					"Could not remove the API connection. Reload settings and retry.",
				type: "error",
			});
		},
	});
	const check = useMutation({
		mutationFn: () => checkQbittorrentConnection(settings.generation),
		onSuccess: (value) => {
			toast.add({
				title: value.available
					? `Connected to qBittorrent ${value.version}.`
					: "qBittorrent connection failed.",
				description: value.available
					? undefined
					: failureDescription(value.code),
				type: value.available ? "success" : "error",
			});
		},
		onError: () => {
			toast.add({
				title: "Could not test the API connection. Reload settings and retry.",
				type: "error",
			});
		},
	});
	const busy = save.isPending || clear.isPending || check.isPending;
	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			{settings.state === "unavailable" && (
				<p role="alert">
					Saved credentials could not be loaded. Enter all connection details to
					replace them.
				</p>
			)}
			{settings.bundled && (
				<div className="space-y-3">
					<p>
						Bundled qBittorrent. Download paths are configured automatically on
						first setup.
					</p>
					<p>
						WebUI username: <strong>{settings.username}</strong>
					</p>
					<div className="action-row">
						<Button
							type="button"
							variant="outline"
							onClick={() => void copy(settings.username)}
						>
							Copy username
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={revealing}
							onClick={() =>
								revealed === null ? void reveal() : setRevealed(null)
							}
						>
							{revealed === null
								? "Show WebUI password"
								: "Hide WebUI password"}
						</Button>
						{revealed !== null && (
							<Button
								type="button"
								variant="outline"
								onClick={() => void copy(revealed)}
							>
								Copy WebUI password
							</Button>
						)}
					</div>
					{revealed !== null && (
						<Input
							aria-label="Saved WebUI password"
							readOnly
							value={revealed}
							autoComplete="off"
						/>
					)}
					<p className="text-sm text-muted-foreground">
						Use these credentials with the Open WebUI link below. After changing
						your password in qBittorrent, update the connection password here.
					</p>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							setRevealed(null);
							setEditing(!editing);
						}}
					>
						{editing
							? "Hide connection settings"
							: "Update password or use an external instance"}
					</Button>
				</div>
			)}
			{editing && (
				<>
					<label htmlFor="qbittorrent-api-url" className="block space-y-2">
						<span className="text-sm font-medium">API URL</span>
						<Input
							id="qbittorrent-api-url"
							type="url"
							required
							maxLength={2048}
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							disabled={busy}
							placeholder="http://qbittorrent:8080"
							aria-describedby="qbittorrent-api-help"
						/>
					</label>
					<p
						id="qbittorrent-api-help"
						className="text-sm text-muted-foreground"
					>
						Backend connection address. A deployment default may be prefilled;
						enter your account below and save to connect.
					</p>
					<label htmlFor="qbittorrent-api-username" className="block space-y-2">
						<span className="text-sm font-medium">Username</span>
						<Input
							id="qbittorrent-api-username"
							autoComplete="username"
							required
							maxLength={256}
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							disabled={busy}
						/>
					</label>
					<label htmlFor="qbittorrent-api-password" className="block space-y-2">
						<span className="text-sm font-medium">Password</span>
						<Input
							id="qbittorrent-api-password"
							type="password"
							autoComplete="new-password"
							maxLength={4096}
							required={!settings.passwordConfigured || !sameAccount}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							disabled={busy}
							aria-describedby="qbittorrent-password-help"
						/>
					</label>
					<p
						id="qbittorrent-password-help"
						className="text-sm text-muted-foreground"
					>
						{settings.passwordConfigured
							? "Password saved. Leave blank to keep it; enter it again when changing the API URL or username."
							: "Enter your qBittorrent account password."}
					</p>
				</>
			)}
			<div className="action-row">
				{editing && (
					<Button type="submit" disabled={busy}>
						{save.isPending ? "Saving API connection…" : "Save API connection"}
					</Button>
				)}
				<Button
					type="button"
					variant="outline"
					disabled={busy || changed || settings.state !== "configured"}
					onClick={() => check.mutate()}
				>
					{check.isPending ? "Testing connection…" : "Test connection"}
				</Button>
				{editing && settings.state !== "unconfigured" && (
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={() => clear.mutate()}
					>
						Remove API connection
					</Button>
				)}
			</div>
		</form>
	);
}

function failureDescription(code: string | null): string {
	if (code === "unauthorized")
		return "Authentication failed. Check your qBittorrent username and password.";
	if (code === "timeout")
		return "The backend could not reach qBittorrent before the request timed out.";
	return "Check the API address, credentials and backend network access.";
}
