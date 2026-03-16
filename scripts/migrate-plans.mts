/**
 * One-time migration: STL30/STL50 → STL200
 * Run with: npx tsx scripts/migrate-plans.mts
 * Then run: npx prisma db push
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
	console.log('Adding new enum values...');
	await prisma.$executeRawUnsafe(`ALTER TYPE "CompanyPlan" ADD VALUE IF NOT EXISTS 'STL200'`);
	await prisma.$executeRawUnsafe(`ALTER TYPE "CompanyPlan" ADD VALUE IF NOT EXISTS 'STL400'`);
	await prisma.$executeRawUnsafe(`ALTER TYPE "CompanyPlan" ADD VALUE IF NOT EXISTS 'STL750'`);

	console.log('Migrating organizations rows...');
	const orgResult = await prisma.$executeRawUnsafe(
		`UPDATE organizations SET plan = 'STL200' WHERE plan IN ('STL30', 'STL50')`
	);
	console.log(`  → ${orgResult} organization(s) updated`);

	console.log('Migrating registration_access_keys rows...');
	const keyResult = await prisma.$executeRawUnsafe(
		`UPDATE registration_access_keys SET plan = 'STL200' WHERE plan IN ('STL30', 'STL50')`
	);
	console.log(`  → ${keyResult} key(s) updated`);

	console.log('\nDone! Now run: npx prisma db push');
}

main()
	.catch((err) => {
		console.error('Migration failed:', err);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
