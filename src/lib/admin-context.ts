import { cookies } from "next/headers";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { shops, staff } from "@/db/schema";
import { getSessionUser, type SessionUser } from "./auth";

export type AdminShop = {
  id: string;
  name: string;
  slug: string;
  role: string;
  accent: string;
};

export type AdminContext = {
  user: SessionUser | null;
  shops: AdminShop[];
  activeShop: AdminShop | null;
};

export async function getAdminContext(): Promise<AdminContext> {
  const user = await getSessionUser();
  if (!user) return { user: null, shops: [], activeShop: null };

  let shopList: AdminShop[];
  if (user.isPlatformAdmin) {
    const rows = await db.select().from(shops).orderBy(shops.createdAt);
    shopList = rows.map((s) => ({ id: s.id, name: s.name, slug: s.slug, role: "owner", accent: s.accent }));
  } else {
    const memberships = await db.select().from(staff).where(eq(staff.userId, user.id));
    const active = memberships.filter((m) => m.active);
    if (active.length === 0) return { user, shops: [], activeShop: null };
    const rows = await db.select().from(shops).where(inArray(shops.id, active.map((m) => m.shopId)));
    shopList = rows.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      role: active.find((m) => m.shopId === s.id)?.role ?? "counter",
      accent: s.accent,
    }));
  }

  const store = await cookies();
  const preferred = store.get("pf_shop")?.value;
  const activeShop = shopList.find((s) => s.id === preferred) ?? shopList[0] ?? null;
  return { user, shops: shopList, activeShop };
}
