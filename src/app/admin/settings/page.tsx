import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { headers } from "next/headers";
import { getAdminContext } from "@/lib/admin-context";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getAdminContext();
  if (!ctx.user || !ctx.activeShop) notFound();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const publicUrl = `${proto}://${host}/s/${ctx.activeShop.slug}`;
  const qrDataUrl = await QRCode.toDataURL(publicUrl, {
    margin: 1,
    width: 520,
    color: { dark: "#151918", light: "#F7F1E7" },
    errorCorrectionLevel: "M",
  });
  return <SettingsClient shopId={ctx.activeShop.id} publicUrl={publicUrl} qrDataUrl={qrDataUrl} />;
}
