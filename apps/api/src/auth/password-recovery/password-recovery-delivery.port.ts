export const PASSWORD_RECOVERY_DELIVERY = Symbol('PASSWORD_RECOVERY_DELIVERY');

export interface PasswordRecoveryDeliveryInput {
  email: string;
  displayName: string;
  resetUrl: string;
  expiresAt: Date;
}

export interface PasswordRecoveryDeliveryResult {
  developmentResetUrl?: string;
}

export interface PasswordRecoveryDeliveryPort {
  deliver(input: PasswordRecoveryDeliveryInput): Promise<PasswordRecoveryDeliveryResult>;
}
