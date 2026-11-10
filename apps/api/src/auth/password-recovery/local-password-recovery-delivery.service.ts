import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PasswordRecoveryDeliveryInput,
  PasswordRecoveryDeliveryPort,
  PasswordRecoveryDeliveryResult,
} from './password-recovery-delivery.port';

@Injectable()
export class LocalPasswordRecoveryDeliveryService implements PasswordRecoveryDeliveryPort {
  private readonly logger = new Logger(LocalPasswordRecoveryDeliveryService.name);

  constructor(private readonly config: ConfigService) {}

  async deliver(input: PasswordRecoveryDeliveryInput): Promise<PasswordRecoveryDeliveryResult> {
    const driver = this.config.get('PASSWORD_RECOVERY_DRIVER', 'local');
    const production = this.config.get('NODE_ENV') === 'production';
    if (driver !== 'local' || production) {
      this.logger.warn('La recuperación fue solicitada, pero no hay un proveedor de correo configurado');
      return {};
    }

    this.logger.log(`Enlace local de recuperación para ${input.email}: ${input.resetUrl}`);
    return { developmentResetUrl: input.resetUrl };
  }
}
