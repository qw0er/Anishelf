import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { useDelayedPending } from "../hooks/use-delayed-pending.js";
import AppHeader from "./app-header.js";
import { Card, CardContent, CardHeader } from "./ui/card.js";
import { Skeleton } from "./ui/skeleton.js";

export default function InitialLoading() {
	const { t } = useTranslation();
	const { pathname } = useLocation();
	const visible = useDelayedPending(true, pathname);
	const player = pathname.startsWith("/files/");
	const settings = pathname === "/settings";

	return (
		<div className="min-h-screen bg-background">
			<AppHeader pending />
			<main className="mx-auto max-w-6xl space-y-6 px-4 py-6" aria-busy="true">
				{visible && (
					<div
						className="space-y-6"
						role="status"
						aria-label={t("loading.pageLabel")}
					>
						{player ? (
							<>
								<Skeleton className="h-9 w-36" />
								<Skeleton className="h-8 w-56" />
								<Skeleton className="aspect-video max-h-[75vh] w-full" />
							</>
						) : settings ? (
							<>
								<Skeleton className="h-8 w-32" />
								<Card className="max-w-2xl">
									<CardHeader>
										<Skeleton className="h-5 w-40" />
									</CardHeader>
									<CardContent className="space-y-4">
										<Skeleton className="h-4 w-40" />
										<Skeleton className="h-9 w-full" />
										<Skeleton className="h-9 w-36" />
									</CardContent>
								</Card>
							</>
						) : (
							<>
								<Card>
									<CardHeader className="gap-4 sm:grid-cols-[1fr_auto]">
										<div className="space-y-2">
											<Skeleton className="h-5 w-32" />
											<Skeleton className="h-4 w-40" />
										</div>
										<div className="flex gap-2">
											<Skeleton className="h-9 w-32" />
											<Skeleton className="h-9 w-24" />
										</div>
									</CardHeader>
								</Card>
								<Skeleton className="h-8 w-56" />
								<Card>
									<CardContent className="space-y-4">
										{[0, 1, 2].map((row) => (
											<Skeleton key={row} className="h-10 w-full" />
										))}
									</CardContent>
								</Card>
							</>
						)}
						<span className="sr-only">{t("loading.page")}</span>
					</div>
				)}
			</main>
		</div>
	);
}
