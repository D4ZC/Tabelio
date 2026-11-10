import { Body, Controller, Get, Param, Post, Query, StreamableFile } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AttachLibraryDocumentDto } from './dto/attach-library-document.dto';
import { LibraryQueryDto } from './dto/library-query.dto';
import { LibraryService } from './library.service';

@Controller('library/documents')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  @RequirePermissions('DOCUMENT_READ')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: LibraryQueryDto) {
    return this.library.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('DOCUMENT_READ')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.library.detail(user, id);
  }

  @Get(':id/download')
  @RequirePermissions('DOCUMENT_READ')
  async download(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { fileName, mimeType, sizeBytes, stream } = await this.library.download(user, id);
    const encodedName = encodeURIComponent(fileName).replace(/[!'()*]/g, (character) => (
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ));
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: `attachment; filename*=UTF-8''${encodedName}`,
      length: sizeBytes,
    });
  }

  @Post(':id/attach')
  @RequirePermissions('DOCUMENT_WRITE')
  attach(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachLibraryDocumentDto,
  ) {
    return this.library.attach(user, id, dto);
  }
}
