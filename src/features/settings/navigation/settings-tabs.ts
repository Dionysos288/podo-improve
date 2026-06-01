export type SettingsTab = {
	label: string;
	segment: string;
	hrefSuffix: `/settings/${string}`;
	adminOnly?: boolean;
};

const baseTabs = [
	{ label: 'Basis', segment: 'basis', hrefSuffix: '/settings/basis' },
	{ label: 'Gebruik', segment: 'gebruik', hrefSuffix: '/settings/gebruik' },
	{ label: 'MDR', segment: 'mdr', hrefSuffix: '/settings/mdr' },
	{ label: 'Gebruikers', segment: 'gebruikers', hrefSuffix: '/settings/gebruikers' },
	{ label: 'Backup & Migratie', segment: 'backup', hrefSuffix: '/settings/backup' },
	{ label: '3D Printer', segment: '3d-printer', hrefSuffix: '/settings/3d-printer' },
] satisfies SettingsTab[];

const adminTab = {
	label: 'Admin',
	segment: 'admin',
	hrefSuffix: '/settings/admin',
	adminOnly: true,
} satisfies SettingsTab;

export function getVisibleSettingsTabs(input: {
	isPlatformAdmin: boolean;
}): SettingsTab[] {
	return input.isPlatformAdmin ? [adminTab, ...baseTabs] : [...baseTabs];
}
