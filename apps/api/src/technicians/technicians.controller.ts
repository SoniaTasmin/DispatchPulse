import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

// Read-only lookups with no business logic, so they query Prisma directly.
@ApiTags('technicians')
@Controller()
export class TechniciansController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('technicians')
  async listTechnicians() {
    const technicians = await this.prisma.technician.findMany({
      include: { skills: true },
      orderBy: { name: 'asc' },
    });
    return technicians.map(({ id, name, city, status, skills }) => ({
      id,
      name,
      city,
      status,
      skills: skills.map((s) => s.skillCode),
    }));
  }

  @Get('skills')
  listSkills() {
    return this.prisma.skill.findMany({ orderBy: { name: 'asc' } });
  }
}
