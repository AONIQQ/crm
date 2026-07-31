import { redirect } from "next/navigation";
import { recordHref } from "@/lib/record-href";

/** Kept for links to the deal page this used to be. */
export default async function DealRedirect({
	params,
}: {
	params: Promise<{ dealId: string }>;
}) {
	const { dealId } = await params;
	redirect(recordHref("/deals", "deal", dealId));
}
