import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RequestPasswordRecoveryDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(32)
  token!: string;

  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres' })
  @Matches(/[a-z]/, { message: 'La contraseña debe incluir una minúscula' })
  @Matches(/[A-Z]/, { message: 'La contraseña debe incluir una mayúscula' })
  @Matches(/[0-9]/, { message: 'La contraseña debe incluir un número' })
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres' })
  @Matches(/[a-z]/, { message: 'La contraseña debe incluir una minúscula' })
  @Matches(/[A-Z]/, { message: 'La contraseña debe incluir una mayúscula' })
  @Matches(/[0-9]/, { message: 'La contraseña debe incluir un número' })
  newPassword!: string;
}
