import type { BaseEntity } from './entity';

export type Role = 'customer' | 'seller';

export interface User extends BaseEntity {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  passwordSalt: string;
  avatar: string;
  roles: Role[];
}

export interface Session extends BaseEntity {
  userId: string;
  token: string;
  expiresAt: string;
}

export interface Address extends BaseEntity {
  userId: string;
  label: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  addressLine: string;
  postalCode: string;
  instructions?: string;
  isDefault: boolean;
}