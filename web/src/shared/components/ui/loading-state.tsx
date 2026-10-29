import { Skeleton } from "./skeleton.js";

export function LoadingState({ label }: { label: string }) {
	return (
		<div role="status" aria-label={label} className="space-y-3">
			<span className="sr-only">{label}</span>
			<div aria-hidden="true" className="space-y-3">
				<Skeleton className="h-4 w-2/3" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-1/2" />
			</div>
		</div>
	);
}
