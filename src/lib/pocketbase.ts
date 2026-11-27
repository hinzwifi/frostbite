import PocketBase from 'pocketbase';
import type { ExpiryThresholds } from '../types/models';

const STORAGE_URL_KEY = 'frostbite_pb_url';

export function getPocketBaseUrl(): string {
  const saved = localStorage.getItem(STORAGE_URL_KEY);
  if (saved !== null) return saved;
  const envUrl = (import.meta.env.VITE_POCKETBASE_URL as string | undefined) ?? '';
  if (envUrl.trim()) return envUrl.trim().replace(/\/+$/, '');
  return window.location.origin;
}

export function setPocketBaseUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  localStorage.setItem(STORAGE_URL_KEY, clean);
  pb.baseURL = clean || window.location.origin;
}

export const pb = new PocketBase(getPocketBaseUrl());
pb.autoCancellation(false);

export interface BootstrapStatus {
  initialized: boolean;
  businessName: string;
  reachable: boolean;
}

/** Checks PocketBase system_bootstrap to determine if first-time admin setup is needed */
export async function checkBootstrapStatus(): Promise<BootstrapStatus> {
  try {
    const res = await pb.collection('system_bootstrap').getList(1, 1);
    const first = res.items[0];
    if (first && first.initialized) {
      return {
        initialized: true,
        businessName: String(first.business_name || 'Frostbite'),
        reachable: true,
      };
    }
    return { initialized: false, businessName: 'Frostbite', reachable: true };
  } catch {
    return { initialized: true, businessName: 'Frostbite', reachable: false };
  }
}

/** Creates the first admin user on a fresh PocketBase instance and initializes Frostbite */
export async function completeFirstTimeSetup(params: {
  serverUrl: string;
  businessName: string;
  ownerName: string;
  email: string;
  password: string;
  defaultStoreCut: number;
  expiryThresholds: ExpiryThresholds;
}): Promise<void> {
  setPocketBaseUrl(params.serverUrl);

  // 1. Create the first user with role = "admin"
  const createdUser = await pb.collection('users').create({
    email: params.email.trim(),
    password: params.password,
    passwordConfirm: params.password,
    name: params.ownerName.trim(),
    role: 'admin',
    emailVisibility: false,
  });

  // 2. Authenticate immediately as the new admin user
  await pb.collection('users').authWithPassword(params.email.trim(), params.password);

  // 3. Mark system_bootstrap as initialized
  await pb.collection('system_bootstrap').create({
    initialized: true,
    business_name: params.businessName.trim() || 'Frostbite',
    admin_user: createdUser.id,
  });

  // 4. Persist initial business profile & expiry thresholds in app_settings
  await pb.collection('app_settings').create({
    key: 'business_profile',
    value: {
      businessName: params.businessName.trim() || 'Frostbite',
      ownerName: params.ownerName.trim(),
      defaultStoreCut: params.defaultStoreCut,
    },
  });

  await pb.collection('app_settings').create({
    key: 'expiry_thresholds',
    value: params.expiryThresholds,
  });
}

export async function loginOwner(email: string, password: string): Promise<void> {
  // Try users collection (first-time admin account) first, then fallback to PocketBase _superusers
  try {
    await pb.collection('users').authWithPassword(email, password);
    return;
  } catch {
    await pb.collection('_superusers').authWithPassword(email, password);
  }
}

export function logoutOwner(): void {
  pb.authStore.clear();
}

export function isAuthenticated(): boolean {
  return pb.authStore.isValid;
}
