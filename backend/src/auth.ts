import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { queryOne, table } from './db.js';

export function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

export interface AuthUser {
  id: number;
  username: string;
  level: number;
  status: number;
}

export async function findUserByUsername(username: string): Promise<any> {
  return queryOne(`SELECT * FROM ${table('user')} WHERE username = ? LIMIT 1`, [username]);
}

export async function findUserById(id: number): Promise<any> {
  return queryOne(`SELECT * FROM ${table('user')} WHERE id = ? LIMIT 1`, [id]);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function checkLevel(user: { level: number } | undefined, required: number): boolean {
  if (!user) return false;
  if (user.level >= 2) return true;
  return user.level >= required;
}

export async function checkDomainPermission(uid: number, domain: string): Promise<boolean> {
  const row = await queryOne(`SELECT * FROM ${table('permission')} WHERE uid = ? AND domain = ? LIMIT 1`, [uid, domain]);
  return !!row;
}