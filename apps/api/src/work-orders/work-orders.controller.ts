import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AssignWorkOrderDto,
  CreateWorkOrderDto,
  ListWorkOrdersQuery,
} from './work-order.dto';
import { WorkOrdersService } from './work-orders.service';

const updatedWorkOrder = { description: 'The updated work order' };
const notFound = { status: 404, description: 'Work order not found' };
const illegalTransition = {
  status: 409,
  description: 'Not allowed from the current status, or changed concurrently',
};

@ApiTags('work-orders')
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Post()
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 422, description: 'Unknown skill' })
  create(@Body() dto: CreateWorkOrderDto) {
    return this.workOrders.create(dto);
  }

  @Get()
  list(@Query() query: ListWorkOrdersQuery) {
    return this.workOrders.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'The work order' })
  @ApiResponse(notFound)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.workOrders.findOne(id);
  }

  /** Every technician with an eligibility verdict and reasons, eligible first. */
  @Get(':id/technician-matches')
  @ApiOkResponse({ description: 'Technicians with eligibility and reasons' })
  @ApiResponse(notFound)
  technicianMatches(@Param('id', ParseIntPipe) id: number) {
    return this.workOrders.technicianMatches(id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @ApiOkResponse(updatedWorkOrder)
  @ApiResponse(notFound)
  @ApiResponse({
    status: 409,
    description:
      'Not allowed from the current status, technician not available, or changed concurrently',
  })
  @ApiResponse({
    status: 422,
    description:
      'Technician does not exist, lacks the skill, or is in another city',
  })
  assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() { technicianId }: AssignWorkOrderDto,
  ) {
    return this.workOrders.assign(id, technicianId);
  }

  @Post(':id/start')
  @HttpCode(200)
  @ApiOkResponse(updatedWorkOrder)
  @ApiResponse(notFound)
  @ApiResponse(illegalTransition)
  start(@Param('id', ParseIntPipe) id: number) {
    return this.workOrders.start(id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOkResponse(updatedWorkOrder)
  @ApiResponse(notFound)
  @ApiResponse(illegalTransition)
  complete(@Param('id', ParseIntPipe) id: number) {
    return this.workOrders.complete(id);
  }
}
