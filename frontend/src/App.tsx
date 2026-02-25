import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { AdminLayout } from "./components/admin/AdminLayout";
import { Dashboard } from "./pages/admin/Dashboard";
import { Appointments } from "./pages/admin/Appointments";
import { Services } from "./pages/admin/Services";
import { Schedule } from "./pages/admin/Schedule";
import { Settings } from "./pages/admin/Settings";
import Finances from "./pages/admin/Finances";
import SecretaryChat from "./pages/admin/SecretaryChat";
import Reports from "./pages/admin/Reports"; // ✅ IMPORT NOVO
import { AdminGuard } from "./components/admin/AdminGuard";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />

          {/* Admin Routes (Protegidas por senha) */}
          <Route
            path="/admin"
            element={
              <AdminGuard>
                <AdminLayout />
              </AdminGuard>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="agendamentos" element={<Appointments />} />
            <Route path="servicos" element={<Services />} />
            <Route path="horarios" element={<Schedule />} />
            <Route path="relatorios" element={<Reports />} /> {/* ✅ NOVA ROTA */}
            <Route path="configuracoes" element={<Settings />} />
            <Route path="financas" element={<Finances />} />
            <Route path="secretaria" element={<SecretaryChat />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
