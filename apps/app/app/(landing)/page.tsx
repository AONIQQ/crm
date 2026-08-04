import { Button } from "@crm/ui/components/button";
import Logo from "@crm/ui/components/logo";
import Link from "next/link";
import { AuthShader } from "@/components/auth-shader";

export default function Home() {
	return (
		<main className="dark relative flex min-h-svh flex-col overflow-hidden bg-background text-foreground">
			<AuthShader />

			<header className="relative flex h-12 shrink-0 items-center gap-2 px-6 sm:px-10">
				<Link href="/" aria-label="Homepage" className="flex">
					<Logo className="size-5 shrink-0" />
				</Link>

				<div className="ml-auto">
					<Button asChild variant="outline" size="sm">
						<Link href="/sign-in">Sign in</Link>
					</Button>
				</div>
			</header>

			<div className="relative flex flex-1 items-center px-6 py-16 sm:px-10">
				<div className="flex max-w-lg flex-col gap-8">
					<div className="flex flex-col gap-4">
						<p className="font-mono text-muted-foreground text-xs/4 uppercase">
							CRM
						</p>
						<h1 className="max-w-[14ch] text-balance font-semibold text-5xl/14">
							Every customer, one place.
						</h1>
						<p className="max-w-[46ch] text-pretty text-muted-foreground text-sm/6">
							Your inbox and calendar become the record. A research agent works
							out who everybody is, and what each account is worth.
						</p>
					</div>

					<div className="flex gap-2">
						<Button asChild>
							<Link href="/sign-in">Get started</Link>
						</Button>
					</div>
				</div>
			</div>

			<footer className="relative px-6 py-8 sm:px-10">
				<p className="font-mono text-muted-foreground text-xs/4">
					Made with love by{" "}
					<a
						href="https://trycomp.ai"
						target="_blank"
						rel="noreferrer"
						className="underline underline-offset-4 hover:text-foreground"
					>
						Comp AI
					</a>
				</p>
			</footer>
		</main>
	);
}
