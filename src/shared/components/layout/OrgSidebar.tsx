'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
	Users,
	FolderOpen,
	Settings,
	LogOut,
	LayoutDashboard,
	UserCog,
} from 'lucide-react';
import { signOut } from '@/src/shared/core/auth/auth-client';

interface OrgSidebarProps {
	orgName: string;
	orgSlug: string;
	userName: string;
	userRole: string;
}

const navItems = [
	{ label: 'Dashboard', href: '', icon: LayoutDashboard },
	{ label: 'Patiënten', href: '/patients', icon: Users },
	{ label: 'Projecten', href: '/projects', icon: FolderOpen },
];

const adminItems = [
	{ label: 'Beheer', href: '/admin', icon: UserCog },
	{ label: 'Instellingen', href: '/settings', icon: Settings },
];

export function OrgSidebar({
	orgName,
	orgSlug,
	userName,
	userRole,
}: OrgSidebarProps) {
	const pathname = usePathname();
	const basePath = `/${orgSlug}`;

	const handleSignOut = async () => {
		await signOut();
		window.location.href = '/login';
	};

	return (
		<aside className="flex h-full w-64 flex-col border-r border-ui-border bg-ui-panel">
			{/* Organization header */}
			<div className="border-b border-ui-border p-6">
				<h1 className="truncate text-xl font-bold text-foreground">
					{orgName}
				</h1>
			</div>

			{/* Navigation */}
			<nav className="flex-1 space-y-2 p-4">
				{navItems.map((item) => {
					const href = `${basePath}${item.href}`;
					const isActive =
						pathname === href ||
						(item.href !== '' && pathname.startsWith(href));
					const Icon = item.icon;

					return (
						<Link
							key={item.href}
							href={href}
							className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
								isActive
									? 'bg-ui-accent/10 text-ui-accent shadow-sm'
									: 'text-ui-muted hover:bg-ui-card hover:text-foreground'
							}`}
						>
							<Icon className="h-5 w-5 shrink-0" />
							{item.label}
						</Link>
					);
				})}

				{userRole === 'ADMIN' && (
					<>
						<div className="my-4 h-px bg-ui-border" />
						{adminItems.map((item) => {
							const href = `${basePath}${item.href}`;
							const isActive = pathname.startsWith(href);
							const Icon = item.icon;

							return (
								<Link
									key={item.href}
									href={href}
									className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
										isActive
											? 'bg-ui-accent/10 text-ui-accent shadow-sm'
											: 'text-ui-muted hover:bg-ui-card hover:text-foreground'
									}`}
								>
									<Icon className="h-5 w-5 shrink-0" />
									{item.label}
								</Link>
							);
						})}
					</>
				)}
			</nav>

			{/* User section */}
			<div className="border-t border-ui-border p-4">
				<div className="mb-3 flex items-center gap-3">
					<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ui-accent/10 text-sm font-semibold text-ui-accent">
						{userName
							.split(' ')
							.map((n: string) => n[0])
							.join('')
							.toUpperCase()
							.slice(0, 2)}
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-semibold text-foreground">
							{userName}
						</p>
						<p className="text-xs text-ui-muted">
							{userRole === 'ADMIN' ? 'Beheerder' : 'Medewerker'}
						</p>
					</div>
				</div>
				<button
					onClick={handleSignOut}
					className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-ui-muted transition-all hover:bg-red-500/10 hover:text-red-400"
				>
					<LogOut className="h-5 w-5 shrink-0" />
					Uitloggen
				</button>
			</div>
		</aside>
	);
}
