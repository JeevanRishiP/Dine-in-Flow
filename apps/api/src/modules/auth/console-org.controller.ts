import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Permission } from '@dineflow/contracts';
import {
  Require,
  CurrentUser,
  type StaffJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { StaffManagementService } from './staff-management.service.js';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export const CreateOutletSchema = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().max(300).optional(),
  timezone: z.string().trim().max(50).default('Asia/Kolkata'),
  settings: z.record(z.unknown()).default({}),
}).strict();

export const UpdateOutletSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  address: z.string().trim().max(300).optional(),
  timezone: z.string().trim().max(50).optional(),
  settings: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const UpdateOrgSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  settings: z.record(z.unknown()).optional(),
}).strict();

export class CreateOutletDto extends createZodDto(CreateOutletSchema) {}
export class UpdateOutletDto extends createZodDto(UpdateOutletSchema) {}
export class UpdateOrgDto extends createZodDto(UpdateOrgSchema) {}

/**
 * Console Controller for Outlets and Organization Settings.
 * Reference: ARCH §6, §7, §12
 */
@Controller('console')
export class ConsoleOrgController {
  constructor(private readonly staffManagementService: StaffManagementService) {}

  @Get('outlets')
  @Require(Permission.OUTLET_READ)
  listOutlets(@CurrentUser() user: StaffJwtPayload) {
    return this.staffManagementService.listOutlets(user.org);
  }

  @Post('outlets')
  @Require(Permission.OUTLET_CREATE)
  @HttpCode(HttpStatus.CREATED)
  createOutlet(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: CreateOutletDto,
  ) {
    return this.staffManagementService.createOutlet(user.org, user.sub, dto);
  }

  @Get('outlets/:id')
  @Require(Permission.OUTLET_READ)
  getOutlet(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') id: string,
  ) {
    return this.staffManagementService.getOutlet(user.org, id);
  }

  @Patch('outlets/:id')
  @Require(Permission.OUTLET_UPDATE)
  updateOutlet(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateOutletDto,
  ) {
    return this.staffManagementService.updateOutlet(user.org, user.sub, id, dto);
  }

  @Get('organization')
  @Require(Permission.ORG_READ)
  getOrganization(@CurrentUser() user: StaffJwtPayload) {
    return this.staffManagementService.getOrganization(user.org);
  }

  @Patch('organization')
  @Require(Permission.ORG_UPDATE)
  updateOrganization(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: UpdateOrgDto,
  ) {
    return this.staffManagementService.updateOrganization(user.org, user.sub, dto);
  }
}
