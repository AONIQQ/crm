import { redirect } from "next/navigation";
import { recordHref } from "@/lib/record-href";

/**
 * The company page that used to live here.
 *
 * A company is a sheet over the companies table now, but the old URL is in
 * people's history and in links they have already sent, so it lands on the
 * table with that company open rather than on a 404.
 */
export default async function CompanyRedirect({
	params,
}: {
	params: Promise<{ companyId: string }>;
}) {
	const { companyId } = await params;
	redirect(recordHref("/companies", "company", companyId));
}
