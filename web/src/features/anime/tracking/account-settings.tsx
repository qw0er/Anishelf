import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../../shared/api/client.js";
import type {
	TrackingAccountResponse,
	TrackingPreviewResponse,
} from "../../../shared/api/contracts.js";
import { Button } from "../../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { Input } from "../../../shared/components/ui/input.js";

const accountKey = ["tracking", "account"] as const;
export function AniListAccountSettings() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [token, setToken] = useState("");
	const [preview, setPreview] = useState<TrackingPreviewResponse | null>(null);
	const account = useQuery({
		queryKey: accountKey,
		queryFn: ({ signal }) =>
			request<TrackingAccountResponse>("/api/tracking/account", "GET", {
				signal,
			}),
		retry: false,
		staleTime: 0,
	});
	const command = useMutation({
		mutationFn: async (
			operation: "preview" | "confirm" | "disconnect" | "check",
		) => {
			if (operation === "preview") {
				const input = token.trim();
				setToken("");
				setPreview(null);
				const result = await request<TrackingPreviewResponse>(
					"/api/tracking/account/preview",
					"POST",
					{},
					{ token: input },
				);
				setPreview(result);
				return;
			}
			let result: TrackingAccountResponse;
			if (operation === "confirm") {
				if (!preview) return;
				result = await request(
					"/api/tracking/account/confirm",
					"POST",
					{},
					{ candidateId: preview.candidateId, generation: preview.generation },
				);
			} else if (operation === "disconnect") {
				if (!account.data) return;
				result = await request(
					"/api/tracking/account",
					"DELETE",
					{},
					{ generation: account.data.generation },
				);
			} else result = await request("/api/tracking/account/check", "POST");
			await client.cancelQueries({ queryKey: ["tracking"] });
			client.removeQueries({
				queryKey: ["tracking"],
				predicate: (query) => query.queryKey[1] !== "account",
			});
			client.setQueryData(accountKey, result);
			setPreview(null);
		},
		onError: () => {
			void client.invalidateQueries({ queryKey: accountKey });
		},
	});
	const busy = command.isPending;
	const current = account.data;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("trackingAccount.title")}</CardTitle>
				<CardDescription>{t("trackingAccount.description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{account.isPending && (
					<p role="status">{t("trackingAccount.loading")}</p>
				)}
				{current && (
					<>
						<p>
							{current.account
								? t("trackingAccount.account", { name: current.account.name })
								: t("trackingAccount.disconnected")}
						</p>
						<p role="status">
							{t(`trackingAccount.states.${current.state}`)} ·{" "}
							{t(`trackingAccount.connectivity.${current.connectivity}`)}
						</p>
						<a
							href={current.authorizationUrl}
							target="_blank"
							rel="noreferrer"
							className="underline"
						>
							{t("trackingAccount.authorize")}
						</a>
						<p className="text-sm text-muted-foreground">
							{t("trackingAccount.instructions")}
						</p>
						<form
							className="space-y-3"
							onSubmit={(event) => {
								event.preventDefault();
								command.mutate("preview");
							}}
						>
							<label htmlFor="anilist-token" className="block space-y-2">
								<span>{t("trackingAccount.token")}</span>
								<Input
									id="anilist-token"
									name="anilist-token"
									type="password"
									autoComplete="off"
									maxLength={8192}
									value={token}
									onChange={(event) => {
										setToken(event.target.value);
										setPreview(null);
									}}
									disabled={busy}
									required
								/>
							</label>
							<Button type="submit" disabled={busy || !token.trim()}>
								{t("trackingAccount.preview")}
							</Button>
						</form>
						{preview && (
							<section
								className="space-y-3"
								aria-label={t("trackingAccount.confirmation")}
							>
								<p>
									{t("trackingAccount.confirmAccount", {
										name: preview.account.name,
									})}
								</p>
								<p className="text-sm text-muted-foreground">
									{t("trackingAccount.replaceNotice")}
								</p>
								<Button
									disabled={busy}
									onClick={() => command.mutate("confirm")}
								>
									{t("trackingAccount.confirm")}
								</Button>
								<Button
									variant="outline"
									disabled={busy}
									onClick={() => setPreview(null)}
								>
									{t("trackingAccount.cancel")}
								</Button>
							</section>
						)}
						{current.account && (
							<div className="flex flex-wrap gap-2">
								<Button
									variant="outline"
									disabled={busy}
									onClick={() => command.mutate("check")}
								>
									{t("trackingAccount.check")}
								</Button>
								<Button
									variant="outline"
									disabled={busy}
									onClick={() => command.mutate("disconnect")}
								>
									{t("trackingAccount.disconnect")}
								</Button>
							</div>
						)}
					</>
				)}
				{(account.error || command.error) && (
					<div role="alert" className="space-y-2">
						<p>{(command.error ?? account.error)?.message}</p>
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => {
								command.reset();
								void account.refetch();
							}}
						>
							{t("trackingAccount.refresh")}
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
