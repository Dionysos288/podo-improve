import { PrismaClient } from '@prisma/client';
import { DEFAULT_MATERIAL_SEEDS } from '../src/features/printers/constants/default-materials';

const prisma = new PrismaClient();

async function main() {
	const orgs = await prisma.organization.findMany({ select: { id: true } });
	for (const org of orgs) {
		const count = await prisma.printMaterial.count({ where: { orgId: org.id } });
		if (count > 0) continue;
		await prisma.printMaterial.createMany({
			data: DEFAULT_MATERIAL_SEEDS.map((seed) => ({
				orgId: org.id,
				name: seed.name,
				filamentType: seed.filamentType,
				isCustomSlot: seed.isCustomSlot,
				nozzleTempC: seed.nozzleTempC,
				bedTempC: seed.bedTempC,
				maxSpeedMmS: seed.maxSpeedMmS,
				sortOrder: seed.sortOrder,
			})),
		});
	}
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
