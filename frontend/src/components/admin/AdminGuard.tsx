import React from "react";
import { useLocation } from "react-router-dom";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  // NÃO salva em localStorage: pede senha sempre que acessar /admin
  const [authed, setAuthed] = React.useState(false);

  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);

  const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

  // Quando mudar de rota para fora do /admin, reseta o acesso
  React.useEffect(() => {
    if (!location.pathname.startsWith("/admin")) {
      setAuthed(false);
      setPassword("");
      setError("");
    }
  }, [location.pathname]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!ADMIN_PASSWORD) {
      setError("Senha do admin não configurada.");
      return;
    }

    if (password === ADMIN_PASSWORD) {
      setAuthed(true);
      setPassword("");
      return;
    }

    setError("Senha incorreta.");
  }

  if (authed) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h1 className="text-xl font-semibold text-slate-900">
          Área Administrativa
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Digite a senha para acessar o painel
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="flex gap-2">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Senha"
              data-cy="admin-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-slate-700"
              autoFocus
            />

            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              title={showPassword ? "Ocultar" : "Mostrar"}
              data-cy="admin-toggle-password"
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-white hover:bg-slate-800"
            data-cy="admin-login-submit"
          >
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
