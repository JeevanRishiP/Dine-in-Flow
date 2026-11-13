import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Permission } from '@dineflow/contracts';
import { Require } from '../../common/decorators/auth.decorators.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { StaffJwtPayload } from './token.service.js';
import { StaffManagementService } from './staff-management.service.js';

const ManagedRoleEnum = z.enum([
  'OWNER',
  'MANAGER',
  'CAPTAIN',
  'KITCHEN',
  'CASHIER',
  'WAITER',
]);

const CreateStaffSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    username: z.string().trim().min(2).max(64),
    password: z.string().min(4).max(128),
    role: ManagedRoleEnum,
    outletId: z.string().uuid().nullable().optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    email: z.string().trim().email().nullable().optional(),
  })
  .strict();

const UpdateStaffSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    username: z.string().trim().min(2).max(64).optional(),
    password: z.string().min(4).max(128).optional(),
    role: ManagedRoleEnum.optional(),
    outletId: z.string().uuid().nullable().optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export class CreateStaffDto extends createZodDto(CreateStaffSchema) {}
export class UpdateStaffDto extends createZodDto(UpdateStaffSchema) {}

/**
 * Owner-only staff credentials & role management endpoints.
 * Reference: ARCH §12, AGENTS §2 rule 4
 */
@Controller('console/staff')
export class ConsoleStaffController {
  constructor(private readonly staffMgmt: StaffManagementService) {}

  @Get()
  @Require(Permission.STAFF_READ)
  async list(@CurrentUser() user: StaffJwtPayload) {
    return this.staffMgmt.listDirectory(user.org);
  }

  @Post()
  @Require(Permission.STAFF_INVITE)
  @HttpCode(201)
  async create(@CurrentUser() user: StaffJwtPayload, @Body() dto: CreateStaffDto) {
    return this.staffMgmt.createStaff(user.org, user.sub, user.role, dto);
  }

  @Patch(':id')
  @Require(Permission.STAFF_UPDATE)
  async update(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffMgmt.updateStaff(user.org, user.sub, user.role, id, dto);
  }

  @Delete(':id')
  @Require(Permission.STAFF_DEACTIVATE)
  async deactivate(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staffMgmt.deactivateStaff(user.org, user.sub, user.role, id);
  }
}

