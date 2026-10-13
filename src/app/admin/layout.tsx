import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/admin-context";
import { AdminShell } from "@/components/admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();
  if (!ctx.user) redirect("/login");
  return (
    <AdminShell
      userName={ctx.user.name}
      userEmail={ctx.user.email}
      isPlatformAdmin={ctx.user.isPlatformAdmin}
      shops={ctx.shops}
      activeShop={ctx.activeShop}
    >
      {children}
    </AdminShell>
  );
}
