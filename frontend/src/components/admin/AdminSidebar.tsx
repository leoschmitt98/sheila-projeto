import { NavLink, useSearchParams } from "react-router-dom";
import {
  Calendar,
  Wrench,
  Clock,
  Settings,
  LayoutDashboard,
  LogOut,
  BarChart3,
  X,
} from "lucide-react";
import { SheilaAvatar } from "@/components/chat/SheilaAvatar";

type AdminSidebarProps = {
  mobileOpen?: boolean;
  onClose?: () => void;
};

const navItems = [
  { to: "/admin", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/admin/agendamentos", icon: Calendar, label: "Agendamentos" },
  { to: "/admin/servicos", icon: Wrench, label: "Serviços" },
  { to: "/admin/horarios", icon: Clock, label: "Horários" },
  { to: "/admin/relatorios", icon: BarChart3, label: "Relatórios" },
  { to: "/admin/configuracoes", icon: Settings, label: "Configurações" },
];

export function AdminSidebar({ mobileOpen = false, onClose }: AdminSidebarProps) {
  const [searchParams] = useSearchParams();
  const slug = (searchParams.get("empresa") || "nando").trim() || "nando";
  const qs = `?empresa=${encodeURIComponent(slug)}`;

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 h-[100dvh] w-64 bg-sidebar border-r border-sidebar-border flex flex-col transform transition-transform duration-200 lg:static lg:h-full lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-6 border-b border-sidebar-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SheilaAvatar size="small" />
            <div>
              <h1 className="font-display font-bold text-sidebar-foreground">Sheila Admin</h1>
              <p className="text-xs text-muted-foreground">Painel de Controle</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="lg:hidden rounded-md p-1 text-sidebar-foreground hover:bg-sidebar-accent"
            aria-label="Fechar sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={`${item.to}${qs}`}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`
              }
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <NavLink
            to={`/${qs}`}
            onClick={onClose}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-200"
          >
            <LogOut size={20} />
            <span className="font-medium">Voltar ao Chat</span>
          </NavLink>
        </div>
      </aside>
    </>
  );
}
