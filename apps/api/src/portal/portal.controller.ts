import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { Public } from '../auth/public.decorator';
import {
  CreatePortalInvitationDto,
  PortalUploadDto,
  ReviewPortalSubmissionDto,
  SavePortalIntakeDto,
} from './dto/portal.dto';
import { PortalService } from './portal.service';

@Controller()
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Post('matters/:matterId/portal-invitations')
  @RequirePermissions('MATTER_WRITE')
  createInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Body() dto: CreatePortalInvitationDto,
  ) {
    return this.portal.createInvitation(user, matterId, dto);
  }

  @Get('matters/:matterId/portal-invitations')
  @RequirePermissions('MATTER_READ')
  listInvitations(@CurrentUser() user: AuthenticatedUser, @Param('matterId') matterId: string) {
    return this.portal.listInvitations(user, matterId);
  }

  @Post('matters/:matterId/portal-invitations/:invitationId/revoke')
  @RequirePermissions('MATTER_WRITE')
  revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.portal.revokeInvitation(user, matterId, invitationId);
  }

  @Post('matters/:matterId/portal-submissions/:submissionId/accept')
  @RequirePermissions('MATTER_WRITE', 'DOCUMENT_WRITE')
  acceptSubmission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: ReviewPortalSubmissionDto,
  ) {
    return this.portal.acceptSubmission(user, matterId, submissionId, dto.comment);
  }

  @Post('matters/:matterId/portal-submissions/:submissionId/reject')
  @RequirePermissions('MATTER_WRITE')
  rejectSubmission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: ReviewPortalSubmissionDto,
  ) {
    return this.portal.rejectSubmission(user, matterId, submissionId, dto.comment);
  }

  @Get('portal-uploads/:uploadId/download')
  @RequirePermissions('DOCUMENT_READ')
  async downloadUpload(@CurrentUser() user: AuthenticatedUser, @Param('uploadId') uploadId: string) {
    const { upload, stream } = await this.portal.downloadUpload(user, uploadId);
    return new StreamableFile(stream, {
      type: upload.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(upload.originalName)}`,
      length: upload.sizeBytes,
    });
  }

  @Public()
  @Get('portal/intake/:token')
  publicView(@Param('token') token: string) {
    return this.portal.publicView(token);
  }

  @Public()
  @Put('portal/intake/:token')
  saveIntake(@Param('token') token: string, @Body() dto: SavePortalIntakeDto) {
    return this.portal.saveIntake(token, dto);
  }

  @Public()
  @Post('portal/intake/:token/uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(
    @Param('token') token: string,
    @Body() dto: PortalUploadDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.portal.upload(token, dto, file);
  }

  @Public()
  @Delete('portal/intake/:token/uploads/:uploadId')
  deleteUpload(@Param('token') token: string, @Param('uploadId') uploadId: string) {
    return this.portal.deleteUpload(token, uploadId);
  }

  @Public()
  @Post('portal/intake/:token/submit')
  submit(@Param('token') token: string) {
    return this.portal.submit(token);
  }
}
