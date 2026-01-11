import Link from 'next/link';
import { Button } from '@/src/shared/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/src/shared/components/ui/card';

export default function Home() {
	return (
		<div className="container mx-auto py-16 px-4">
			<div className="text-center mb-12">
				<h1 className="text-4xl font-bold mb-4">
					Medical Insole CAD Application
				</h1>
				<p className="text-xl text-gray-600">
					Design and manufacture custom medical insoles
				</p>
			</div>

			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-4xl mx-auto">
				<Card>
					<CardHeader>
						<CardTitle>Patients</CardTitle>
						<CardDescription>
							Manage patient records and information
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Link href="/patients" className="block">
							<Button className="w-full">View Patients</Button>
						</Link>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Projects</CardTitle>
						<CardDescription>View and manage design projects</CardDescription>
					</CardHeader>
					<CardContent>
						<Link href="/projects" className="block">
							<Button className="w-full">View Projects</Button>
						</Link>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Design</CardTitle>
						<CardDescription>3D design workspace for insoles</CardDescription>
					</CardHeader>
					<CardContent>
						<Button className="w-full" variant="outline" disabled>
							Coming Soon
						</Button>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
