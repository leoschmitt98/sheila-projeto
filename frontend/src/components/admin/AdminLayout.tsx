import { Outlet, useSearchParams } from "react-router-dom";
import { Menu } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useAdminProfessionalContext } from "@/hooks/useAdminProfessionalContext";
import { useEffect, useState } from "react";
import { AdminSidebar } from "./AdminSidebar";
import { AdminNotifications } from "./AdminNotifications";

export function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const slug = resolveEmpresaSlug({ search: `?${searchParams.toString()}` });
  const { hasMulti, activeProfessionals, selectedProfessionalId, setSelectedProfessionalId } = useAdminProfessionalContext(slug);

  useEffect(() => {
    document.body.classList.add("overflow-hidden");
    return () => document.body.classList.remove("overflow-hidden");
  }, []);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <AdminSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="z-30 flex shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md border border-border p-2"
            aria-label="Abrir menu"
            data-cy="btn-admin-open-menu"
          >
            <Menu size={18} />
          </button>
          <span className="font-medium">Painel Admin</span>
        </div>

        <section className="flex min-h-0 flex-1 flex-col p-3 md:p-4 lg:p-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <AdminNotifications slug={slug} />
            <div className="w-full max-w-xs">
              <Select value={selectedProfessionalId} onValueChange={setSelectedProfessionalId} disabled={!hasMulti}>
                <SelectTrigger>
                  <SelectValue placeholder="Visão geral" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Visão Geral</SelectItem>
                  {activeProfessionals.map((p) => (
                    <SelectItem key={p.Id} value={String(p.Id)}>{p.Nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/40 bg-card/40 p-3 md:p-4 pb-6">
            <Outlet />
          </div>
        </section>
      </main>
    </div>
  );
}
