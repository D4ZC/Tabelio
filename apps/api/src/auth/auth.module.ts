import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalPasswordRecoveryDeliveryService } from './password-recovery/local-password-recovery-delivery.service';
import { PASSWORD_RECOVERY_DELIVERY } from './password-recovery/password-recovery-delivery.port';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'local-development-secret-change-me'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalPasswordRecoveryDeliveryService,
    { provide: PASSWORD_RECOVERY_DELIVERY, useExisting: LocalPasswordRecoveryDeliveryService },
  ],
  exports: [JwtModule],
})
export class AuthModule {}
