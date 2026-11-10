import { IsString } from 'class-validator';

export class AssignMatterResponsibleDto {
  @IsString()
  responsibleMembershipId!: string;
}
