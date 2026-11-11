import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePersonDto } from './dto/create-person.dto';
import type { CreatePropertyDto } from './dto/create-property.dto';
import type { UpdatePersonDto, UpdatePropertyDto } from './dto/update-directory.dto';

@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listPeople(user: AuthenticatedUser) {
    return this.prisma.person.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { legalName: 'asc' },
    });
  }

  /** Versión ligera para selectores: con miles de personas el listado completo pesa varios MB. */
  listPeopleOptions(user: AuthenticatedUser) {
    return this.prisma.person.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, legalName: true, type: true },
      orderBy: { legalName: 'asc' },
    });
  }

  listPropertyOptions(user: AuthenticatedUser) {
    return this.prisma.property.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, displayName: true, city: true, state: true },
      orderBy: { displayName: 'asc' },
    });
  }

  async createPerson(user: AuthenticatedUser, dto: CreatePersonDto) {
    const duplicate = await this.prisma.person.findFirst({
      where: {
        organizationId: user.organizationId,
        OR: [
          ...(dto.taxId ? [{ taxId: { equals: dto.taxId.trim(), mode: 'insensitive' as const } }] : []),
          ...(dto.email ? [{ email: { equals: dto.email.trim(), mode: 'insensitive' as const } }] : []),
        ],
      },
      select: { id: true, legalName: true },
    });
    if (duplicate) {
      throw new ConflictException(`Ya existe una persona coincidente: ${duplicate.legalName}`);
    }

    const person = await this.prisma.person.create({
      data: {
        ...dto,
        legalName: dto.legalName.trim(),
        taxId: dto.taxId?.trim().toUpperCase(),
        curp: dto.curp?.trim().toUpperCase(),
        email: dto.email?.trim().toLowerCase(),
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        organizationId: user.organizationId,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PERSON_CREATED',
      entityType: 'Person',
      entityId: person.id,
    });
    return person;
  }

  listProperties(user: AuthenticatedUser) {
    return this.prisma.property.findMany({
      where: { organizationId: user.organizationId },
      include: { owner: { select: { id: true, legalName: true } } },
      orderBy: { displayName: 'asc' },
    });
  }

  async createProperty(user: AuthenticatedUser, dto: CreatePropertyDto) {
    if (dto.ownerPersonId) {
      const owner = await this.prisma.person.findFirst({
        where: { id: dto.ownerPersonId, organizationId: user.organizationId },
      });
      if (!owner) throw new NotFoundException('La persona propietaria no existe');
    }

    const duplicate = await this.prisma.property.findFirst({
      where: {
        organizationId: user.organizationId,
        addressLine1: { equals: dto.addressLine1.trim(), mode: 'insensitive' },
        city: { equals: dto.city.trim(), mode: 'insensitive' },
      },
      select: { id: true, displayName: true },
    });
    if (duplicate) {
      throw new ConflictException(`El inmueble ya está registrado como ${duplicate.displayName}`);
    }

    const property = await this.prisma.property.create({
      data: {
        ...dto,
        displayName: dto.displayName.trim(),
        addressLine1: dto.addressLine1.trim(),
        city: dto.city.trim(),
        state: dto.state.trim(),
        organizationId: user.organizationId,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PROPERTY_CREATED',
      entityType: 'Property',
      entityId: property.id,
    });
    return property;
  }

  async updatePerson(user: AuthenticatedUser, id: string, dto: UpdatePersonDto) {
    const person = await this.prisma.person.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!person) throw new NotFoundException('Persona no encontrada');

    const duplicateConditions = [
      ...(dto.taxId ? [{ taxId: { equals: dto.taxId.trim(), mode: 'insensitive' as const } }] : []),
      ...(dto.email ? [{ email: { equals: dto.email.trim(), mode: 'insensitive' as const } }] : []),
    ];
    if (duplicateConditions.length) {
      const duplicate = await this.prisma.person.findFirst({
        where: {
          id: { not: id },
          organizationId: user.organizationId,
          OR: duplicateConditions,
        },
        select: { legalName: true },
      });
      if (duplicate) throw new ConflictException(`Ya existe una persona coincidente: ${duplicate.legalName}`);
    }

    const updated = await this.prisma.person.update({
      where: { id },
      data: {
        ...dto,
        legalName: dto.legalName?.trim(),
        taxId: dto.taxId?.trim().toUpperCase(),
        curp: dto.curp?.trim().toUpperCase(),
        email: dto.email?.trim().toLowerCase(),
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PERSON_UPDATED',
      entityType: 'Person',
      entityId: id,
    });
    return updated;
  }

  async updateProperty(user: AuthenticatedUser, id: string, dto: UpdatePropertyDto) {
    const property = await this.prisma.property.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!property) throw new NotFoundException('Inmueble no encontrado');

    if (dto.ownerPersonId) {
      const owner = await this.prisma.person.findFirst({
        where: { id: dto.ownerPersonId, organizationId: user.organizationId },
      });
      if (!owner) throw new NotFoundException('La persona propietaria no existe');
    }

    const addressLine1 = dto.addressLine1?.trim() ?? property.addressLine1;
    const city = dto.city?.trim() ?? property.city;
    const duplicate = await this.prisma.property.findFirst({
      where: {
        id: { not: id },
        organizationId: user.organizationId,
        addressLine1: { equals: addressLine1, mode: 'insensitive' },
        city: { equals: city, mode: 'insensitive' },
      },
      select: { displayName: true },
    });
    if (duplicate) throw new ConflictException(`El inmueble ya está registrado como ${duplicate.displayName}`);

    const updated = await this.prisma.property.update({
      where: { id },
      data: {
        ...dto,
        displayName: dto.displayName?.trim(),
        addressLine1: dto.addressLine1?.trim(),
        city: dto.city?.trim(),
        state: dto.state?.trim(),
      },
      include: { owner: { select: { id: true, legalName: true } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'PROPERTY_UPDATED',
      entityType: 'Property',
      entityId: id,
    });
    return updated;
  }
}
