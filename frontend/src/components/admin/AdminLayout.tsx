import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import { useState } from "react";
import { AdminSidebar } from "./AdminSidebar";

export function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <main className="flex-1 w-full overflow-auto">
        <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-md border border-border p-2"
              aria-label="Abrir menu"
            >
              <Menu size={18} />
            </button>
            <span className="font-medium">Painel Admin</span>
          </div>
        </div>

        <div className="p-4 md:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
