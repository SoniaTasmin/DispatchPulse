import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient, TechnicianStatus } from '../src/generated/prisma/client';

const { AVAILABLE, OFF_DUTY } = TechnicianStatus;

const skills = [
  { code: 'NETWORKING', name: 'Networking' },
  { code: 'POS_HARDWARE', name: 'POS hardware' },
  { code: 'ELECTRICAL', name: 'Electrical' },
  { code: 'PRINTER', name: 'Printer repair' },
];

// Chosen so a "NETWORKING in Dhaka" work order shows every eligibility outcome:
// eligible, missing skill, off duty, and other city.
const technicians = [
  {
    name: 'Rahim Uddin',
    city: 'Dhaka',
    status: AVAILABLE,
    skills: ['NETWORKING'],
  },
  {
    name: 'Nusrat Jahan',
    city: 'Dhaka',
    status: AVAILABLE,
    skills: ['NETWORKING', 'POS_HARDWARE'],
  },
  {
    name: 'Tanvir Ahmed',
    city: 'Dhaka',
    status: AVAILABLE,
    skills: ['PRINTER'],
  },
  {
    name: 'Farhana Akter',
    city: 'Dhaka',
    status: OFF_DUTY,
    skills: ['NETWORKING', 'ELECTRICAL'],
  },
  {
    name: 'Sabbir Hossain',
    city: 'Dhaka',
    status: AVAILABLE,
    skills: ['ELECTRICAL', 'POS_HARDWARE'],
  },
  {
    name: 'Arif Chowdhury',
    city: 'Chattogram',
    status: AVAILABLE,
    skills: ['NETWORKING'],
  },
  {
    name: 'Mitu Rahman',
    city: 'Chattogram',
    status: AVAILABLE,
    skills: ['POS_HARDWARE', 'PRINTER'],
  },
  {
    name: 'Shirin Sultana',
    city: 'Chattogram',
    status: OFF_DUTY,
    skills: ['ELECTRICAL'],
  },
];

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(process.env.DATABASE_URL!),
  });
  try {
    for (const skill of skills) {
      await prisma.skill.upsert({
        where: { code: skill.code },
        update: { name: skill.name },
        create: skill,
      });
    }

    // Technicians have no natural key to upsert on, so seed them only into an empty table.
    if ((await prisma.technician.count()) > 0) {
      console.log('Technicians already present, skipping.');
      return;
    }
    // One transaction, so a failure can't leave a half-seeded table that the check above would skip.
    await prisma.$transaction(
      technicians.map(({ skills: skillCodes, ...technician }) =>
        prisma.technician.create({
          data: {
            ...technician,
            skills: { create: skillCodes.map((skillCode) => ({ skillCode })) },
          },
        }),
      ),
    );
    console.log(
      `Seeded ${skills.length} skills and ${technicians.length} technicians.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
