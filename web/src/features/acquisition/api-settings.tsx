import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
	const { t } = useTranslation();
	const query = useQuery({
		queryKey,
		queryFn: ({ signal }) =>
			getQbittorrentConnection({ signal: boundedSignal(signal) }),
	});
	return (
		<section
			className="space-y-3"
			aria-label={t("acquisition.api.ariaConnection")}
		>
			<h3 className="text-sm font-medium">{t("acquisition.api.connection")}</h3>
			{query.isPending ? (
				<p role="status">{t("acquisition.api.loading")}</p>
			) : query.isError ? (
				<div role="alert">
					{t("acquisition.api.loadFailed")}{" "}
					<Button variant="outline" onClick={() => void query.refetch()}>
						{t("acquisition.api.retry")}
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
	const { t } = useTranslation();
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
				title: t("acquisition.api.credentialsLoadFailed"),
				type: "error",
			});
		} finally {
			setRevealing(false);
		}
	}
	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			toast.add({ title: t("acquisition.api.copied"), type: "success" });
		} catch {
			toast.add({
				title: t("acquisition.api.copyFailed"),
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
				title: t("acquisition.api.saved"),
				type: "success",
			});
		},
		onError: () => {
			toast.add({
				title: t("acquisition.api.saveFailed"),
				type: "error",
			});
		},
	});
	const clear = useMutation({
		mutationFn: () => clearQbittorrentConnection(settings.generation),
		onSuccess: (value) => {
			saved(value);
			toast.add({
				title: t("acquisition.api.removed"),
				type: "success",
			});
		},
		onError: () => {
			toast.add({
				title: t("acquisition.api.removeFailed"),
				type: "error",
			});
		},
	});
	const check = useMutation({
		mutationFn: () => checkQbittorrentConnection(settings.generation),
		onSuccess: (value) => {
			toast.add({
				title: value.available
					? t("acquisition.api.connected", { version: value.version })
					: t("acquisition.api.connectionFailed"),
				description: value.available ? undefined : t(failureKey(value.code)),
				type: value.available ? "success" : "error",
			});
		},
		onError: () => {
			toast.add({
				title: t("acquisition.api.testFailed"),
				type: "error",
			});
		},
	});
	const busy = save.isPending || clear.isPending || check.isPending;
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			{settings.state === "unavailable" && (
				<p role="alert">{t("acquisition.api.credentialsUnavailable")}</p>
			)}
			{settings.bundled && (
				<div className="flex flex-col gap-3">
					<p className="text-sm text-muted-foreground">
						{t("acquisition.api.bundledDescription")}
					</p>
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<span>
							{t("acquisition.api.webuiUsername")}{" "}
							<strong>{settings.username}</strong>
						</span>
						<Button
							type="button"
							variant="outline"
							onClick={() => void copy(settings.username)}
						>
							{t("acquisition.api.copyUsername")}
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
								? t("acquisition.api.showPassword")
								: t("acquisition.api.hidePassword")}
						</Button>
						{revealed !== null && (
							<Button
								type="button"
								variant="outline"
								onClick={() => void copy(revealed)}
							>
								{t("acquisition.api.copyPassword")}
							</Button>
						)}
					</div>
					{revealed !== null && (
						<Input
							aria-label={t("acquisition.api.savedPassword")}
							readOnly
							value={revealed}
							autoComplete="off"
						/>
					)}
					<p className="text-sm text-muted-foreground">
						{t("acquisition.api.bundledHelp")}
					</p>
				</div>
			)}
			{editing && (
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="flex flex-col gap-2 sm:col-span-2">
						<label
							className="text-sm font-medium"
							htmlFor="qbittorrent-api-url"
						>
							{t("acquisition.api.url")}
						</label>
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
						<p
							id="qbittorrent-api-help"
							className="text-sm text-muted-foreground"
						>
							{t("acquisition.api.urlHelp")}
						</p>
					</div>
					<div className="flex flex-col gap-2">
						<label
							className="text-sm font-medium"
							htmlFor="qbittorrent-api-username"
						>
							{t("acquisition.api.username")}
						</label>
						<Input
							id="qbittorrent-api-username"
							autoComplete="username"
							required
							maxLength={256}
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							disabled={busy}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<label
							className="text-sm font-medium"
							htmlFor="qbittorrent-api-password"
						>
							{t("acquisition.api.password")}
						</label>
						<Input
							id="qbittorrent-api-password"
							type="password"
							autoComplete="new-password"
							maxLength={4096}
							required={!settings.passwordConfigured || !sameAccount}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							disabled={busy}
							aria-describedby={
								settings.passwordConfigured
									? "qbittorrent-password-help"
									: undefined
							}
						/>
						{settings.passwordConfigured && (
							<p
								id="qbittorrent-password-help"
								className="text-sm text-muted-foreground"
							>
								{t("acquisition.api.passwordSaved")}
							</p>
						)}
					</div>
				</div>
			)}
			<div className="action-row">
				{settings.bundled && (
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							setRevealed(null);
							setEditing(!editing);
						}}
					>
						{editing
							? t("acquisition.api.hideSettings")
							: t("acquisition.api.updateSettings")}
					</Button>
				)}
				{editing && (
					<Button type="submit" disabled={busy}>
						{save.isPending
							? t("acquisition.api.saving")
							: t("acquisition.api.save")}
					</Button>
				)}
				<Button
					type="button"
					variant="outline"
					disabled={busy || changed || settings.state !== "configured"}
					onClick={() => check.mutate()}
				>
					{check.isPending
						? t("acquisition.api.testing")
						: t("acquisition.api.test")}
				</Button>
				{editing && settings.state !== "unconfigured" && (
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={() => clear.mutate()}
					>
						{t("acquisition.api.remove")}
					</Button>
				)}
			</div>
		</form>
	);
}

function failureKey(code: string | null): string {
	if (code === "unauthorized") return "acquisition.api.failureUnauthorized";
	if (code === "timeout") return "acquisition.api.failureTimeout";
	return "acquisition.api.failureDefault";
}
