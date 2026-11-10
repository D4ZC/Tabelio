import { MembershipRole } from '@despacho/database';
import { IsEmail, IsEnum, IsString, Matches, MinLength } from 'class-validator';

export class CreateMemberDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  displayName!: string;

  @IsString()
  @MinLength(10, { message: 'La contraseña temporal debe tener al menos 10 caracteres' })
  @Matches(/[a-z]/, { message: 'La contraseña temporal debe incluir una minúscula' })
  @Matches(/[A-Z]/, { message: 'La contraseña temporal debe incluir una mayúscula' })
  @Matches(/[0-9]/, { message: 'La contraseña temporal debe incluir un número' })
  temporaryPassword!: string;

  @IsEnum(MembershipRole)
  role!: MembershipRole;
}

export class UpdateMemberRoleDto {
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}
