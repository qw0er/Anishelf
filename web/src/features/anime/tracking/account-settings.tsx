import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../../shared/api/client.js";
import type {
	TrackingAccountResponse,
	TrackingPreviewResponse,
} from "../../../shared/api/contracts.js";
import { Button, buttonStyles } from "../../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { Input } from "../../../shared/components/ui/input.js";

import { animeLibraryQueryKey } from "../shared/query-keys.js";
import { accountQuery } from "./queries.js";

const accountKey = accountQuery().queryKey;
export function TrackingAccountSettings() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [credential, setCredential] = useState("");
	const [preview, setPreview] = useState<TrackingPreviewResponse | null>(null);
	const account = useQuery(accountQuery());
	const command = useMutation({
		mutationFn: async (
			operation: "preview" | "confirm" | "disconnect" | "check",
		) => {
			if (operation === "preview") {
				const input = credential.trim();
				setCredential("");
				setPreview(null);
				const result = await request<TrackingPreviewResponse>(
					"/api/tracking/account/preview",
					"POST",
					{},
					{ credential: input },
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
			await client.cancelQueries({ queryKey: animeLibraryQueryKey });
			client.removeQueries({ queryKey: animeLibraryQueryKey });
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
				<CardTitle>
					{current?.provider.name ?? t("trackingAccount.title")}
				</CardTitle>
				<CardDescription>{t("trackingAccount.description")}</CardDescription>
			</CardHeader>
			<CardContent className="min-w-0 space-y-4">
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
						<p className="text-sm text-muted-foreground">
							{t("trackingAccount.instructions")}
						</p>
						<form
							id="tracking-credential-form"
							className="space-y-3"
							onSubmit={(event) => {
								event.preventDefault();
								command.mutate("preview");
							}}
						>
							<label htmlFor="tracking-credential" className="block space-y-2">
								<span>{current.provider.authorization.label}</span>
								<Input
									id="tracking-credential"
									name="tracking-credential"
									type="password"
									autoComplete="off"
									maxLength={8192}
									value={credential}
									onChange={(event) => {
										setCredential(event.target.value);
										setPreview(null);
									}}
									disabled={busy}
									required
								/>
							</label>
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
							</section>
						)}
					</>
				)}
				<fieldset
					aria-label={t("trackingAccount.actions")}
					className="flex min-w-0 flex-wrap items-center gap-2"
				>
					{current && (
						<>
							{current.provider.authorization.url && (
								<a
									href={current.provider.authorization.url}
									target="_blank"
									rel="noreferrer"
									className={buttonStyles("outline")}
								>
									{t("trackingAccount.authorize")}
								</a>
							)}
							<Button
								type="submit"
								form="tracking-credential-form"
								disabled={busy || !credential.trim()}
							>
								{t("trackingAccount.preview")}
							</Button>
							{preview && (
								<>
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
								</>
							)}
							{current.account && (
								<>
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
								</>
							)}
						</>
					)}
					{(account.error || command.error) && (
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
					)}
				</fieldset>
				{(account.error || command.error) && (
					<div role="alert" className="space-y-2">
						<p>{(command.error ?? account.error)?.message}</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
