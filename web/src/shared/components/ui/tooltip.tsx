import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { type ReactElement, type ReactNode, useId, useState } from "react";

export function Tooltip({
	children,
	content,
	openOnClick = false,
}: {
	children: ReactElement;
	content: ReactNode;
	openOnClick?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const popupId = useId();
	return (
		<TooltipPrimitive.Root
			open={openOnClick ? open : undefined}
			onOpenChange={openOnClick ? setOpen : undefined}
		>
			<TooltipPrimitive.Trigger
				{...(openOnClick
					? { "aria-describedby": open ? popupId : undefined }
					: {})}
				render={children}
				onClick={openOnClick ? () => setOpen(true) : undefined}
			/>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Positioner sideOffset={6} className="z-50">
					<TooltipPrimitive.Popup
						{...(openOnClick ? { id: popupId, role: "tooltip" as const } : {})}
						data-slot="tooltip-content"
						className="max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md"
					>
						{content}
					</TooltipPrimitive.Popup>
				</TooltipPrimitive.Positioner>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}
