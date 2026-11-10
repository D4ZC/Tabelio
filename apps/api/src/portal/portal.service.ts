import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentType,
  MatterStatus,
  PersonType,
  PortalSubmissionStatus,
  Prisma,
  TaskPriority,
} from '@despacho/database';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ObjectStorageService } from '../documents/object-storage.service';
import { MattersService } from '../matters/matters.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import type {
  CreatePortalInvitationDto,
  PortalUploadDto,
  SavePortalIntakeDto,
} from './dto/portal.dto';

const PORTAL_DOCUMENT_TYPES = new Set<DocumentType>([
  DocumentType.LANDLORD_ID,
  DocumentType.TENANT_ID,
  DocumentType.GUARANTOR_ID,
  DocumentType.TAX_ID,
  DocumentType.PROOF_OF_ADDRESS,
  DocumentType.PROPERTY_TITLE,
  DocumentType.GUARANTEE_PROPERTY_TITLE,
  DocumentType.LEASE_ANNEX,
  DocumentType.OTHER,
]);

const PORTAL_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/heic',
]);

const expectedIdentityType: Record<string, DocumentType | undefined> = {
  LANDLORD: DocumentType.LANDLORD_ID,
  REQUESTING_PARTY: DocumentType.LANDLORD_ID,
  TENANT: DocumentType.TENANT_ID,
  COMPLEMENTARY_PARTY: DocumentType.TENANT_ID,
  GUARANTOR: DocumentType.GUARANTOR_ID,
};

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly audit: AuditService,
    private readonly matters: MattersService,
    private readonly tasks: TasksService,
    private readonly config: ConfigService,
  ) {}

  async createInvitation(
    user: AuthenticatedUser,
    matterId: string,
    dto: CreatePortalInvitationDto,
  ) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
      select: { id: true, reference: true, status: true },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (matter.status === MatterStatus.CLOSED || matter.status === MatterStatus.CANCELLED) {
      throw new BadRequestException('No se pueden emitir invitaciones para un expediente concluido');
    }
    if (dto.personId) {
      const person = await this.prisma.person.findFirst({
        where: { id: dto.personId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!person) throw new NotFoundException('La persona seleccionada no pertenece a la organización');
    }
    const duplicate = await this.prisma.portalInvitation.findFirst({
      where: {
        organizationId: user.organizationId,
        matterId,
        partyRole: dto.partyRole,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        OR: [{ submission: null }, { submission: { status: { not: PortalSubmissionStatus.ACCEPTED } } }],
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('Ya existe una invitación activa para ese rol');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? 7) * 86_400_000);
    const invitation = await this.prisma.portalInvitation.create({
      data: {
        organizationId: user.organizationId,
        matterId,
        tokenHash: this.hashToken(rawToken),
        invitedEmail: dto.invitedEmail?.trim().toLowerCase(),
        partyRole: dto.partyRole,
        personId: dto.personId,
        expiresAt,
        createdById: user.userId,
        submission: {
          create: {
            organizationId: user.organizationId,
            matterId,
            status: PortalSubmissionStatus.DRAFT,
          },
        },
      },
      select: {
        id: true,
        partyRole: true,
        invitedEmail: true,
        expiresAt: true,
        createdAt: true,
        invitedPerson: { select: { id: true, legalName: true } },
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'PORTAL_INVITATION_CREATED',
      entityType: 'PortalInvitation',
      entityId: invitation.id,
      payload: { partyRole: dto.partyRole, expiresAt: expiresAt.toISOString() },
    });
    const webOrigin = this.config.get('WEB_ORIGIN', 'http://localhost:3000').replace(/\/$/, '');
    return { ...invitation, portalUrl: `${webOrigin}/portal/${rawToken}` };
  }

  async listInvitations(user: AuthenticatedUser, matterId: string) {
    const exists = await this.prisma.matter.count({
      where: { id: matterId, organizationId: user.organizationId },
    });
    if (!exists) throw new NotFoundException('Expediente no encontrado');
    const invitations = await this.prisma.portalInvitation.findMany({
      where: { matterId, organizationId: user.organizationId },
      select: {
        id: true,
        invitedEmail: true,
        partyRole: true,
        expiresAt: true,
        revokedAt: true,
        lastAccessedAt: true,
        createdAt: true,
        invitedPerson: { select: { id: true, legalName: true } },
        createdBy: { select: { id: true, displayName: true } },
        submission: {
          select: {
            id: true,
            status: true,
            personData: true,
            submittedAt: true,
            reviewedAt: true,
            reviewComment: true,
            acceptedPerson: { select: { id: true, legalName: true } },
            reviewedBy: { select: { id: true, displayName: true } },
            uploads: {
              select: {
                id: true,
                type: true,
                originalName: true,
                mimeType: true,
                sizeBytes: true,
                checksum: true,
                createdAt: true,
                acceptedDocumentId: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return invitations.map((invitation) => ({
      ...invitation,
      effectiveStatus: invitation.submission?.status === PortalSubmissionStatus.ACCEPTED
        ? 'ACCEPTED'
        : invitation.revokedAt
          ? 'REVOKED'
          : invitation.expiresAt <= now
          ? 'EXPIRED'
          : invitation.submission?.status ?? 'DRAFT',
    }));
  }

  async revokeInvitation(user: AuthenticatedUser, matterId: string, invitationId: string) {
    const invitation = await this.prisma.portalInvitation.findFirst({
      where: { id: invitationId, matterId, organizationId: user.organizationId },
    });
    if (!invitation) throw new NotFoundException('Invitación no encontrada');
    if (invitation.revokedAt) return invitation;
    const updated = await this.prisma.portalInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'PORTAL_INVITATION_REVOKED',
      entityType: 'PortalInvitation',
      entityId: invitation.id,
    });
    return updated;
  }

  async publicView(rawToken: string) {
    const invitation = await this.activeInvitation(rawToken);
    await this.prisma.portalInvitation.update({
      where: { id: invitation.id },
      data: { lastAccessedAt: new Date() },
    });
    return this.publicPayload(invitation.id);
  }

  async saveIntake(rawToken: string, dto: SavePortalIntakeDto) {
    const invitation = await this.activeInvitation(rawToken);
    const submission = invitation.submission!;
    if (submission.status === PortalSubmissionStatus.PENDING_REVIEW) {
      throw new BadRequestException('La información ya fue enviada y está en revisión');
    }
    const personData = this.normalizePersonData(dto);
    await this.prisma.portalSubmission.update({
      where: { id: submission.id },
      data: {
        personData: personData as Prisma.InputJsonValue,
        status: PortalSubmissionStatus.DRAFT,
        submittedAt: null,
        reviewedAt: null,
        reviewedById: null,
        reviewComment: null,
      },
    });
    await this.audit.record({
      organizationId: invitation.organizationId,
      matterId: invitation.matterId,
      action: 'PORTAL_DRAFT_SAVED',
      entityType: 'PortalSubmission',
      entityId: submission.id,
      payload: { fields: Object.keys(personData) },
    });
    return this.publicPayload(invitation.id);
  }

  async upload(rawToken: string, dto: PortalUploadDto, file?: Express.Multer.File) {
    const invitation = await this.activeInvitation(rawToken);
    const submission = invitation.submission!;
    if (!file) throw new BadRequestException('Selecciona un archivo');
    if (!PORTAL_DOCUMENT_TYPES.has(dto.type)) {
      throw new BadRequestException('El tipo documental no está disponible en el portal');
    }
    if (!PORTAL_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Formato no permitido. Usa PDF, Word, JPG, PNG o HEIC');
    }
    if (submission.status === PortalSubmissionStatus.PENDING_REVIEW) {
      throw new BadRequestException('La información ya fue enviada y está en revisión');
    }
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const [stagedDuplicate, repositoryDuplicate] = await Promise.all([
      this.prisma.portalUpload.findFirst({
        where: {
          organizationId: invitation.organizationId,
          matterId: invitation.matterId,
          checksum,
        },
        select: { originalName: true, type: true },
      }),
      this.prisma.document.findFirst({
        where: {
          organizationId: invitation.organizationId,
          matterId: invitation.matterId,
          checksum,
        },
        select: { originalName: true, type: true, version: true },
      }),
    ]);
    if (stagedDuplicate) {
      throw new ConflictException(
        `Este archivo ya fue enviado como ${stagedDuplicate.originalName} (${stagedDuplicate.type})`,
      );
    }
    if (repositoryDuplicate) {
      throw new ConflictException(
        `Este archivo ya existe en el expediente como ${repositoryDuplicate.originalName} (${repositoryDuplicate.type} v${repositoryDuplicate.version})`,
      );
    }
    const safeExtension = extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const objectKey = `${invitation.organizationId}/${invitation.matterId}/portal/${randomUUID()}${safeExtension}`;
    await this.storage.putBuffer(objectKey, file.buffer, file.mimetype, file.originalname);
    const upload = await this.prisma.portalUpload.create({
      data: {
        organizationId: invitation.organizationId,
        matterId: invitation.matterId,
        submissionId: submission.id,
        type: dto.type,
        originalName: file.originalname,
        objectKey,
        bucket: this.storage.bucket,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksum,
      },
      select: { id: true, type: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
    await this.audit.record({
      organizationId: invitation.organizationId,
      matterId: invitation.matterId,
      action: 'PORTAL_FILE_UPLOADED',
      entityType: 'PortalUpload',
      entityId: upload.id,
      payload: { type: upload.type, originalName: upload.originalName },
    });
    return upload;
  }

  async deleteUpload(rawToken: string, uploadId: string) {
    const invitation = await this.activeInvitation(rawToken);
    const submission = invitation.submission!;
    if (submission.status === PortalSubmissionStatus.PENDING_REVIEW) {
      throw new BadRequestException('La información ya fue enviada y está en revisión');
    }
    const upload = await this.prisma.portalUpload.findFirst({
      where: { id: uploadId, submissionId: submission.id, acceptedDocumentId: null },
    });
    if (!upload) throw new NotFoundException('Archivo no encontrado');
    await this.storage.delete(upload.objectKey);
    await this.prisma.portalUpload.delete({ where: { id: upload.id } });
    await this.audit.record({
      organizationId: invitation.organizationId,
      matterId: invitation.matterId,
      action: 'PORTAL_FILE_REMOVED',
      entityType: 'PortalUpload',
      entityId: upload.id,
      payload: { type: upload.type, originalName: upload.originalName },
    });
    return { removed: true };
  }

  async submit(rawToken: string) {
    const invitation = await this.activeInvitation(rawToken);
    const submission = invitation.submission!;
    if (submission.status === PortalSubmissionStatus.PENDING_REVIEW) {
      return this.publicPayload(invitation.id);
    }
    const data = this.personData(submission.personData);
    if (!data.legalName?.trim()) throw new BadRequestException('Captura el nombre completo o razón social');
    const expectedType = expectedIdentityType[invitation.partyRole];
    if (expectedType) {
      const identityCount = await this.prisma.portalUpload.count({
        where: { submissionId: submission.id, type: expectedType },
      });
      if (!identityCount) {
        throw new BadRequestException(`Carga la identificación requerida (${expectedType})`);
      }
    }
    const submittedAt = new Date();
    await this.prisma.portalSubmission.update({
      where: { id: submission.id },
      data: {
        status: PortalSubmissionStatus.PENDING_REVIEW,
        submittedAt,
        reviewedAt: null,
        reviewedById: null,
        reviewComment: null,
      },
    });
    await this.audit.record({
      organizationId: invitation.organizationId,
      matterId: invitation.matterId,
      action: 'PORTAL_SUBMISSION_RECEIVED',
      entityType: 'PortalSubmission',
      entityId: submission.id,
      payload: { partyRole: invitation.partyRole },
    });
    const matter = await this.prisma.matter.findUniqueOrThrow({
      where: { id: invitation.matterId },
      select: { responsibleMembershipId: true },
    });
    await this.tasks.ensureSystemTask({
      organizationId: invitation.organizationId,
      matterId: invitation.matterId,
      title: 'Revisar captura externa',
      description: `Validar la información y los documentos enviados para el rol ${invitation.partyRole}.`,
      priority: TaskPriority.HIGH,
      dueAt: new Date(submittedAt.getTime() + 2 * 86_400_000),
      assigneeMembershipId: matter.responsibleMembershipId,
      deduplicationKey: `PORTAL_REVIEW:${submission.id}`,
    });
    return this.publicPayload(invitation.id);
  }

  async acceptSubmission(user: AuthenticatedUser, matterId: string, submissionId: string, comment: string) {
    const submission = await this.reviewableSubmission(user, matterId, submissionId);
    const data = this.personData(submission.personData);
    if (!data.legalName?.trim()) throw new BadRequestException('La captura no contiene un nombre válido');

    if (!submission.invitation.personId) {
      const duplicateConditions = [
        ...(data.taxId ? [{ taxId: { equals: data.taxId, mode: 'insensitive' as const } }] : []),
        ...(data.email ? [{ email: { equals: data.email, mode: 'insensitive' as const } }] : []),
      ];
      if (duplicateConditions.length) {
        const duplicate = await this.prisma.person.findFirst({
          where: { organizationId: user.organizationId, OR: duplicateConditions },
          select: { legalName: true },
        });
        if (duplicate) {
          throw new ConflictException(`La captura coincide con ${duplicate.legalName}; emite la invitación asociada a esa persona`);
        }
      }
    }

    const reviewedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const personValues = this.personWriteData(data);
      const person = submission.invitation.personId
        ? await tx.person.update({
          where: { id: submission.invitation.personId },
          data: personValues,
        })
        : await tx.person.create({
          data: {
            ...personValues,
            type: data.type ?? PersonType.INDIVIDUAL,
            legalName: data.legalName!.trim(),
            organizationId: user.organizationId,
          },
        });

      await tx.matterParty.upsert({
        where: {
          matterId_personId_role: {
            matterId,
            personId: person.id,
            role: submission.invitation.partyRole,
          },
        },
        update: {},
        create: {
          organizationId: user.organizationId,
          matterId,
          personId: person.id,
          role: submission.invitation.partyRole,
        },
      });

      const acceptedDocuments = [];
      for (const portalUpload of submission.uploads) {
        if (portalUpload.acceptedDocumentId) continue;
        const latest = await tx.document.findFirst({
          where: { organizationId: user.organizationId, matterId, type: portalUpload.type },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const document = await tx.document.create({
          data: {
            organizationId: user.organizationId,
            matterId,
            personId: person.id,
            type: portalUpload.type,
            originalName: portalUpload.originalName,
            objectKey: portalUpload.objectKey,
            bucket: portalUpload.bucket,
            mimeType: portalUpload.mimeType,
            sizeBytes: portalUpload.sizeBytes,
            checksum: portalUpload.checksum,
            version: (latest?.version ?? 0) + 1,
            uploadedById: user.userId,
          },
        });
        await tx.portalUpload.update({
          where: { id: portalUpload.id },
          data: { acceptedDocumentId: document.id },
        });
        acceptedDocuments.push(document);
      }

      const accepted = await tx.portalSubmission.update({
        where: { id: submission.id },
        data: {
          status: PortalSubmissionStatus.ACCEPTED,
          reviewedAt,
          reviewedById: user.userId,
          reviewComment: comment.trim(),
          acceptedPersonId: person.id,
        },
      });
      await tx.portalInvitation.update({
        where: { id: submission.invitationId },
        data: { revokedAt: reviewedAt },
      });
      if (submission.matter.status === MatterStatus.PENDING_CLIENT) {
        await tx.matter.update({ where: { id: matterId }, data: { status: MatterStatus.INTEGRATION } });
      }
      return { submission: accepted, person, documents: acceptedDocuments };
    });

    await this.matters.refreshChecklist(user, matterId);
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'PORTAL_SUBMISSION_ACCEPTED',
      entityType: 'PortalSubmission',
      entityId: submission.id,
      payload: {
        personId: result.person.id,
        partyRole: submission.invitation.partyRole,
        documentIds: result.documents.map((document) => document.id),
        comment: comment.trim(),
      },
    });
    await this.tasks.completeSystemTask(
      user.organizationId,
      `PORTAL_REVIEW:${submission.id}`,
      user.userId,
    );
    return result;
  }

  async rejectSubmission(user: AuthenticatedUser, matterId: string, submissionId: string, comment: string) {
    const submission = await this.reviewableSubmission(user, matterId, submissionId);
    const rejected = await this.prisma.portalSubmission.update({
      where: { id: submission.id },
      data: {
        status: PortalSubmissionStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedById: user.userId,
        reviewComment: comment.trim(),
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'PORTAL_SUBMISSION_REJECTED',
      entityType: 'PortalSubmission',
      entityId: submission.id,
      payload: { comment: comment.trim() },
    });
    await this.tasks.completeSystemTask(
      user.organizationId,
      `PORTAL_REVIEW:${submission.id}`,
      user.userId,
    );
    return rejected;
  }

  async downloadUpload(user: AuthenticatedUser, uploadId: string) {
    const upload = await this.prisma.portalUpload.findFirst({
      where: { id: uploadId, organizationId: user.organizationId },
    });
    if (!upload) throw new NotFoundException('Archivo de portal no encontrado');
    const stream = await this.storage.open(upload.objectKey);
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: upload.matterId,
      actorUserId: user.userId,
      action: 'PORTAL_FILE_DOWNLOADED',
      entityType: 'PortalUpload',
      entityId: upload.id,
    });
    return { upload, stream };
  }

  private async activeInvitation(rawToken: string) {
    if (!rawToken || rawToken.length < 32) throw new NotFoundException('Invitación no encontrada');
    const invitation = await this.prisma.portalInvitation.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: {
        organization: { select: { name: true } },
        matter: { select: { reference: true, title: true, kind: true } },
        invitedPerson: true,
        submission: { include: { uploads: { orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!invitation) throw new NotFoundException('Invitación no encontrada');
    if (invitation.revokedAt || invitation.submission?.status === PortalSubmissionStatus.ACCEPTED) {
      throw new GoneException('La invitación ya no está activa');
    }
    if (invitation.expiresAt <= new Date()) throw new GoneException('La invitación venció');
    return invitation;
  }

  private async publicPayload(invitationId: string) {
    const invitation = await this.prisma.portalInvitation.findUniqueOrThrow({
      where: { id: invitationId },
      select: {
        partyRole: true,
        expiresAt: true,
        invitedEmail: true,
        organization: { select: { name: true } },
        matter: { select: { reference: true, title: true, kind: true } },
        invitedPerson: { select: { legalName: true } },
        submission: {
          select: {
            status: true,
            personData: true,
            submittedAt: true,
            reviewComment: true,
            uploads: {
              select: { id: true, type: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    return {
      organizationName: invitation.organization.name,
      matter: invitation.matter,
      invitation: {
        partyRole: invitation.partyRole,
        expiresAt: invitation.expiresAt,
        invitedEmail: invitation.invitedEmail,
        invitedPersonName: invitation.invitedPerson?.legalName,
      },
      submission: invitation.submission,
      allowedDocumentTypes: [...PORTAL_DOCUMENT_TYPES],
      expectedIdentityType: expectedIdentityType[invitation.partyRole],
    };
  }

  private async reviewableSubmission(user: AuthenticatedUser, matterId: string, submissionId: string) {
    const submission = await this.prisma.portalSubmission.findFirst({
      where: { id: submissionId, matterId, organizationId: user.organizationId },
      include: { invitation: true, matter: { select: { status: true } }, uploads: true },
    });
    if (!submission) throw new NotFoundException('Captura del portal no encontrada');
    if (submission.status !== PortalSubmissionStatus.PENDING_REVIEW) {
      throw new BadRequestException('La captura no se encuentra pendiente de revisión');
    }
    return submission;
  }

  private normalizePersonData(dto: SavePortalIntakeDto) {
    return Object.fromEntries(Object.entries(dto).flatMap(([key, value]) => {
      if (typeof value !== 'string') return value === undefined ? [] : [[key, value]];
      const trimmed = value.trim();
      if (!trimmed) return [];
      if (key === 'email') return [[key, trimmed.toLowerCase()]];
      if (key === 'taxId') return [[key, trimmed.toUpperCase()]];
      return [[key, trimmed]];
    })) as SavePortalIntakeDto;
  }

  private personData(value: Prisma.JsonValue | null): SavePortalIntakeDto {
    if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    return value as SavePortalIntakeDto;
  }

  private personWriteData(data: SavePortalIntakeDto) {
    return {
      type: data.type ?? PersonType.INDIVIDUAL,
      legalName: data.legalName!.trim(),
      givenName: data.givenName,
      familyName: data.familyName,
      gender: data.gender,
      nationality: data.nationality,
      birthPlaceCity: data.birthPlaceCity,
      birthPlaceState: data.birthPlaceState,
      birthPlaceCountry: data.birthPlaceCountry,
      birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
      maritalStatus: data.maritalStatus,
      occupation: data.occupation,
      taxId: data.taxId?.toUpperCase(),
      email: data.email?.toLowerCase(),
      phone: data.phone,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      state: data.state,
      postalCode: data.postalCode,
      country: data.country ?? 'México',
      identificationType: data.identificationType,
      identificationNumber: data.identificationNumber,
      notes: data.notes,
    };
  }

  private hashToken(rawToken: string) {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
