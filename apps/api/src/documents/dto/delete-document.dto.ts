import { Equals, IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteDocumentDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;

  @IsString()
  @Equals('ELIMINAR')
  confirmation!: string;
}
