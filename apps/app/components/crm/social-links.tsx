import LogoGithub from "@carbon/icons-react/es/LogoGithub";
import LogoLinkedin from "@carbon/icons-react/es/LogoLinkedin";
import LogoX from "@carbon/icons-react/es/LogoX";
import Money from "@carbon/icons-react/es/Money";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Button } from "@crm/ui/components/button";
import type { CarbonIcon } from "@crm/ui/components/icon";
import { Icon } from "@crm/ui/components/icon";

type Link<T> = { key: keyof T; label: string; icon: CarbonIcon };

export type CompanyLinks = {
	linkedinUrl: string | null;
	twitterUrl: string | null;
	githubUrl: string | null;
	pricingUrl: string | null;
	careersUrl: string | null;
};

export type ContactLinks = {
	linkedinUrl: string | null;
	twitterUrl: string | null;
	githubUrl: string | null;
};

/**
 * The website is not in this list — it is the domain in the sheet header,
 * which is a link, because that is what a domain should be. What is left are
 * the places the agent found this company that its name does not give you.
 */
const COMPANY_LINKS: Link<CompanyLinks>[] = [
	{ key: "linkedinUrl", label: "LinkedIn", icon: LogoLinkedin },
	{ key: "twitterUrl", label: "X", icon: LogoX },
	{ key: "githubUrl", label: "GitHub", icon: LogoGithub },
	{ key: "pricingUrl", label: "Pricing", icon: Money },
	{ key: "careersUrl", label: "Careers", icon: UserMultiple },
];

/**
 * The same row for a person, minus the two that only a company has.
 *
 * Email and phone are not here either: they are in the stats strip at the top
 * of the sheet, where the answer to "how do I reach them" belongs.
 */
const CONTACT_LINKS: Link<ContactLinks>[] = [
	{ key: "linkedinUrl", label: "LinkedIn", icon: LogoLinkedin },
	{ key: "twitterUrl", label: "X", icon: LogoX },
	{ key: "githubUrl", label: "GitHub", icon: LogoGithub },
];

function present<T>(record: T, links: Link<T>[]) {
	return links.flatMap((link) => {
		const href = record[link.key];
		return typeof href === "string" && href ? [{ ...link, href }] : [];
	});
}

export function hasCompanyLinks(company: CompanyLinks): boolean {
	return present(company, COMPANY_LINKS).length > 0;
}

export function hasContactLinks(contact: ContactLinks): boolean {
	return present(contact, CONTACT_LINKS).length > 0;
}

/**
 * Every link says where it goes.
 *
 * A bare row of glyphs works for LinkedIn and GitHub, whose marks people know,
 * and fails for "pricing" and "careers", which have no mark — so the row comes
 * out half legible and reads as clip art. Labels cost one line and remove the
 * guessing.
 */
function SocialLinks<T>({ record, links }: { record: T; links: Link<T>[] }) {
	const rows = present(record, links);

	if (rows.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{rows.map((link) => (
				<Button key={String(link.key)} asChild variant="outline" size="sm">
					<a href={link.href} target="_blank" rel="noreferrer noopener">
						<Icon icon={link.icon} data-icon="inline-start" />
						{link.label}
					</a>
				</Button>
			))}
		</div>
	);
}

export function CompanySocials({ company }: { company: CompanyLinks }) {
	return <SocialLinks record={company} links={COMPANY_LINKS} />;
}

export function ContactSocials({ contact }: { contact: ContactLinks }) {
	return <SocialLinks record={contact} links={CONTACT_LINKS} />;
}
