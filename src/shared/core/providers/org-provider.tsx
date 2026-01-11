'use client';

import { createContext, useContext, ReactNode } from 'react';

export interface Organization {
	id: string;
	name: string;
	slug: string;
}

export interface OrgContextType {
	organization: Organization;
}

const OrgContext = createContext<OrgContextType | null>(null);

export function OrgProvider({
	organization,
	children,
}: {
	organization: Organization;
	children: ReactNode;
}) {
	return (
		<OrgContext.Provider value={{ organization }}>
			{children}
		</OrgContext.Provider>
	);
}

export function useOrg() {
	const context = useContext(OrgContext);
	if (!context) {
		throw new Error('useOrg must be used within an OrgProvider');
	}
	return context;
}

export function useOrgSlug() {
	const { organization } = useOrg();
	return organization.slug;
}
