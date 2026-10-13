import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, staff } from "@/db/schema";

export const SESSION_COOKIE = "pf_session";
const TOKEN_COOKIE = "pf_token";

// ---------- password hashing (scrypt) ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ---------- sessions ----------

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
};

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const store = await cookies();
  store.set(SESSION_COOKIE, `${userId}.${token}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  // keep an id-only cookie readable by client components (not sensitive)
  store.set(TOKEN_COOKIE, userId, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(TOKEN_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const raw = store.get(SESSION_COOKIE)?.value;
    if (!raw) return null;
    const userId = raw.split(".")[0];
    if (!userId) return null;
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isPlatformAdmin: users.isPlatformAdmin,
        active: users.active,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const u = rows[0];
    if (!u || !u.active) return null;
    return { id: u.id, email: u.email, name: u.name, isPlatformAdmin: u.isPlatformAdmin };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new ApiError(401, "AUTH_REQUIRED", "Please sign in to continue.");
  return u;
}

export const STAFF_ROLES = ["owner", "manager", "operator", "counter"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Returns the user's role for a shop, or null. Platform admins act as owner. */
export async function getStaffRole(shopId: string, user: SessionUser): Promise<StaffRole | null> {
  if (user.isPlatformAdmin) return "owner";
  const rows = await db
    .select({ role: staff.role, active: staff.active })
    .from(staff)
    .where(eq(staff.shopId, shopId))
    .limit(50);
  const match = rows.find((r) => r.active);
  return match ? (match.role as StaffRole) : null;
}

export async function requireStaff(shopId: string, minRoles?: StaffRole[]) {
  const user = await requireUser();
  const role = await getStaffRole(shopId, user);
  if (!role) throw new ApiError(403, "FORBIDDEN", "You do not have access to this shop.");
  if (minRoles && !minRoles.includes(role)) {
    throw new ApiError(403, "FORBIDDEN", "Your role does not permit this action.");
  }
  return { user, role };
}

export class ApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return Response.json(
      { ok: false, error: { code: err.code, message: err.message, retryable: err.retryable } },
      { status: err.status },
    );
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  console.error("[api-error]", message);
  return Response.json(
    { ok: false, error: { code: "INTERNAL", message: "Something went wrong. Please retry." } },
    { status: 500 },
  );
}

export function ok(data: unknown, init?: number) {
  return Response.json({ ok: true, ...((data as object) ?? {}) }, { status: init ?? 200 });
}
