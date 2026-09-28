import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

function App() {
	return (
		<main className="flex min-h-svh items-center justify-center p-6">
			<Card className="w-full max-w-sm border-none bg-transparent shadow-none">
				<CardHeader className="flex flex-col items-center gap-4 text-center">
					<img src="/favicon.svg" alt="" width={96} height={96} />
					<CardTitle>
						<h1 className="text-3xl font-semibold tracking-tight">Anishelf</h1>
					</CardTitle>
					<CardDescription>Your local media shelf</CardDescription>
				</CardHeader>
			</Card>
		</main>
	);
}

export default App;
