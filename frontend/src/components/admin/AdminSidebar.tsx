import { NavLink } from "react-router-dom";
import {
  Calendar,
  Wrench,
  Clock,
  Settings,
  LayoutDashboard,
  LogOut,
  BarChart3,
} from "lucide-react";
import { SheilaAvatar } from "@/components/chat/SheilaAvatar";

const navItems = [
  { to: "/admin", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/admin/agendamentos", icon: Calendar, label: "Agendamentos" },
  { to: "/admin/servicos", icon: Wrench, label: "Serviços" },
  { to: "/admin/horarios", icon: Clock, label: "Horários" },

  // ✅ nova tela separada
  { to: "/admin/relatorios", icon: BarChart3, label: "Relatórios" },

  { to: "/admin/configuracoes", icon: Settings, label: "Configurações" },
];

export function AdminSidebar() {
  return (
    <aside className="w-64 h-screen bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <SheilaAvatar size="small" />
          <div>
            <h1 className="font-display font-bold text-sidebar-foreground">
              Sheila Admin
            </h1>
            <p className="text-xs text-muted-foreground">Painel de Controle</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
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

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <NavLink
          to="/"
          className="flex items-center gap-3 px-4 py-3 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-200"
        >
          <LogOut size={20} />
          <span className="font-medium">Voltar ao Chat</span>
        </NavLink>
      </div>
    </aside>
  );
}
