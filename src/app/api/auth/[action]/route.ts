import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ApiError, createSession, destroySession, errorResponse, getSessionUser, hashPassword, ok, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(_req: Request, ctx: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await ctx.params;

    if (action === "register") {
      const body = await _req.json().catch(() => null);
      const name = String(body?.name ?? "").trim();
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      if (name.length < 2) throw new ApiError(400, "BAD_INPUT", "Please enter your full name.");
      if (!EMAIL_RE.test(email)) throw new ApiError(400, "BAD_INPUT", "Please enter a valid email address.");
      if (password.length < 8) throw new ApiError(400, "BAD_INPUT", "Password must be at least 8 characters.");
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
      const total = await db.select({ n: count() }).from(users);
      const isFirst = Number(total[0]?.n ?? 0) === 0;
      const [user] = await db
        .insert(users)
        .values({ name, email, passwordHash: hashPassword(password), isPlatformAdmin: isFirst })
        .returning();
      await createSession(user.id);
      return ok({ user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin } });
    }

    if (action === "login") {
      const body = await _req.json().catch(() => null);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0];
      if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
        throw new ApiError(401, "BAD_CREDENTIALS", "Incorrect email or password.");
      }
      await createSession(user.id);
      return ok({ user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin } });
    }

    if (action === "logout") {
      await destroySession();
      return ok({});
    }

    throw new ApiError(404, "NOT_FOUND", "Unknown auth action");
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET() {
  try {
    const user = await getSessionUser();
    return ok({ user });
  } catch (err) {
    return errorResponse(err);
  }
}
