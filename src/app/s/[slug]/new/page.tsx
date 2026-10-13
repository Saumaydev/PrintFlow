import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shops } from "@/db/schema";
import { OrderBuilder } from "@/components/order-builder";

export const dynamic = "force-dynamic";

export default async function NewOrderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  if (!shop) notFound();
  const profile = shop.profile as Record<string, unknown>;
  return (
    <OrderBuilder
      shop={{
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        acceptOnline: profile.acceptOnlinePayments !== false,
        acceptCounter: profile.acceptCounterPayments !== false,
      }}
    />
  );
}
