import { Menu } from "@base-ui/react/menu";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuSub = Menu.SubmenuRoot;

export function DropdownMenuSubTrigger(props: Menu.SubmenuTrigger.Props) {
	return (
		<Menu.SubmenuTrigger
			className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
			{...props}
		/>
	);
}

export function DropdownMenuContent({
	children,
	submenu = false,
}: {
	children: React.ReactNode;
	submenu?: boolean;
}) {
	return (
		<Menu.Portal keepMounted>
			<Menu.Positioner
				align={submenu ? "start" : "end"}
				side={submenu ? "right" : "bottom"}
				sideOffset={4}
				className="z-50"
			>
				<Menu.Popup
					className={`min-w-48 max-w-[calc(100vw-1rem)] max-h-[var(--available-height)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none ${submenu ? "w-72" : ""}`}
				>
					{children}
				</Menu.Popup>
			</Menu.Positioner>
		</Menu.Portal>
	);
}

export function DropdownMenuItem({ className, ...props }: Menu.Item.Props) {
	return (
		<Menu.Item
			className={(state) =>
				`flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50 ${typeof className === "function" ? className(state) : (className ?? "")}`
			}
			{...props}
		/>
	);
}
