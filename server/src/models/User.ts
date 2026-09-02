import bcrypt from 'bcryptjs';
import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/** SPEC section 4: bcrypt cost factor for every password hash. */
export const BCRYPT_ROUNDS = 12;

/** SPEC section 4: soft lock for 15 minutes after 10 consecutive failures. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 10;
export const ACCOUNT_LOCK_MS = 15 * 60 * 1000;

export interface UserAttributes {
  name: string;
  email: string;
  password: string;
  avatarUrl?: string;
  university?: string;
  gradYear?: number;
  targetRoles: string[];
  weeklyGoal: number;
  theme: Theme;
  timezone: string;
  emailRemindersEnabled: boolean;
  lastLoginAt?: Date;
  emailVerified: boolean;
  emailVerificationTokenHash?: string;
  emailVerificationExpires?: Date;
  pendingEmail?: string;
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;
  passwordChangedAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  acceptedTermsAt: Date;
  deletedAt?: Date;
  isDemo: boolean;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}

export type UserModelType = Model<UserAttributes, Record<string, never>, UserMethods>;
export type UserDocument = HydratedDocument<UserAttributes, UserMethods>;

/** Fields that must never leave the server, stripped by `toJSON`. */
const PRIVATE_FIELDS = [
  'password',
  'emailVerificationTokenHash',
  'emailVerificationExpires',
  'passwordResetTokenHash',
  'passwordResetExpires',
  'failedLoginAttempts',
  'lockedUntil',
  '__v',
] as const;

const userSchema = new Schema<UserAttributes, UserModelType, UserMethods>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, required: true, select: false },
    avatarUrl: { type: String },
    university: { type: String, trim: true, maxlength: 120 },
    gradYear: { type: Number, min: 1950, max: 2100 },
    targetRoles: { type: [String], default: [] },
    weeklyGoal: { type: Number, default: 5, min: 0, max: 100 },
    theme: { type: String, enum: THEMES, default: 'system' },
    timezone: { type: String, default: 'UTC' },
    emailRemindersEnabled: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpires: { type: Date },
    pendingEmail: { type: String, lowercase: true, trim: true },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date },
    passwordChangedAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date },
    acceptedTermsAt: { type: Date, required: true },
    deletedAt: { type: Date },
    isDemo: { type: Boolean, default: false },
    schemaVersion: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_document, record: Record<string, unknown>) => {
        record.id = record._id;
        delete record._id;
        for (const field of PRIVATE_FIELDS) delete record[field];
        return record;
      },
    },
  },
);

userSchema.pre('save', async function hashPasswordOnChange(next) {
  if (!this.isModified('password')) {
    next();
    return;
  }

  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  next();
});

/**
 * Compares a plaintext candidate against the stored hash. Throws rather than
 * returning false when the hash was not selected, so a query that forgot
 * `.select('+password')` fails loudly instead of rejecting every valid login.
 */
userSchema.methods.comparePassword = async function comparePassword(
  candidate: string,
): Promise<boolean> {
  if (typeof this.password !== 'string' || this.password.length === 0) {
    throw new Error('comparePassword called on a user loaded without +password');
  }

  return bcrypt.compare(candidate, this.password);
};

export const User = model<UserAttributes, UserModelType>('User', userSchema);

export type UserId = Types.ObjectId;
