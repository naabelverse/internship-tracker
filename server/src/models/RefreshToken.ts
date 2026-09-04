import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

export const REVOKED_REASONS = [
  'rotated',
  'logout',
  'logout_all',
  'password_changed',
  'password_reset',
  'reuse_detected',
  'session_revoked',
  'account_deleted',
] as const;

export type RevokedReason = (typeof REVOKED_REASONS)[number];

export interface RefreshTokenAttributes {
  user: Types.ObjectId;
  /**
   * Identifies every token descended from a single login. Rotation copies it
   * unchanged, which turns family revocation into one indexed `updateMany`
   * instead of walking the `replacedBy` chain document by document.
   */
  family: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: RevokedReason;
  replacedBy?: Types.ObjectId;
  userAgent?: string;
  ip?: string;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type RefreshTokenModelType = Model<RefreshTokenAttributes>;
export type RefreshTokenDocument = HydratedDocument<RefreshTokenAttributes>;

const refreshTokenSchema = new Schema<RefreshTokenAttributes, RefreshTokenModelType>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    family: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: REVOKED_REASONS },
    replacedBy: { type: Schema.Types.ObjectId, ref: 'RefreshToken' },
    userAgent: { type: String, maxlength: 512 },
    ip: { type: String, maxlength: 64 },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

// Family revocation and the session list both query by owner plus family.
refreshTokenSchema.index({ user: 1, family: 1 });

// Expired rows are useless for reuse detection, so let MongoDB reap them.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenAttributes, RefreshTokenModelType>(
  'RefreshToken',
  refreshTokenSchema,
);
