'use client';

import { usePathname } from 'next/navigation';
import { OrgSidebar } from './OrgSidebar';

interface ConditionalSidebarProps {
	orgName: string;
	orgSlug: string;
	userName: string;
	userRole: string;
	children: React.ReactNode;
}

export function ConditionalSidebar({
	orgName,
	orgSlug,
	userName,
	userRole,
	children,
}: ConditionalSidebarProps) {
	const pathname = usePathname();
	const isDesignRoute = pathname.includes('/design');

	if (isDesignRoute) {
		return <>{children}</>;
	}

	return (
		<div className="flex h-screen overflow-hidden bg-background">
			<OrgSidebar
				orgName={orgName}
				orgSlug={orgSlug}
				userName={userName}
				userRole={userRole}
			/>
			<main className="flex-1 overflow-auto">{children}</main>
		</div>
	);
}
