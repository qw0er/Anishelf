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
			<main className="page-container page-content stack-page" aria-busy="true">
				{visible && (
					<div
						className="stack-page"
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
								<Card className="w-full max-w-2xl">
									<CardHeader>
										<Skeleton className="h-4 w-40" />
									</CardHeader>
									<CardContent className="flex min-w-0 flex-col gap-4">
										<Skeleton className="h-4 w-40" />
										<Skeleton className="h-9 w-full" />
										<Skeleton className="h-9 w-36" />
									</CardContent>
								</Card>
							</>
						) : (
							<>
								<Card>
									<CardHeader className="gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
										<div className="flex min-w-0 flex-col gap-2">
											<Skeleton className="h-4 w-32" />
											<Skeleton className="h-4 w-40" />
										</div>
										<div className="action-row">
											<Skeleton className="h-9 w-32" />
											<Skeleton className="h-9 w-24" />
										</div>
									</CardHeader>
								</Card>
								<Skeleton className="h-8 w-56" />
								<Card>
									<CardContent className="flex min-w-0 flex-col gap-4">
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
