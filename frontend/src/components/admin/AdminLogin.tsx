import React from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { buildEmpresaPath, resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { clearAllAdminSessionTokens } from "@/lib/adminSession";

type AdminLoginResponse = {
  ok: true;
  token: string;
  exp: number;
  slug: string;
};

type AdminSessionResponse = {
  ok: true;
  session: {
    slug: string;
    empresaId: number;
    exp: number;
  };
};

export function AdminLogin() {
  const [searchParams] = useSearchParams();
  const slug = React.useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const sessionKey = React.useMemo(() => `adminToken:${slug}`, [slug]);

  const [checking, setChecking] = React.useState(true);
  const [authed, setAuthed] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);

  React.useEffect(() => {
    let alive = true;

    async function checkSession() {
      setChecking(true);
      const token = window.sessionStorage.getItem(sessionKey);
      if (!token) {
        if (alive) {
          setAuthed(false);
          setChecking(false);
        }
        return;
      }

      try {
        const data = await apiGet<AdminSessionResponse>("/api/admin/session", {
          headers: { Authorization: `Bearer ${token}` },
        } as RequestInit);

        if (!alive) return;
        if (data?.session?.slug === slug) {
          setAuthed(true);
        } else {
          clearAllAdminSessionTokens();
          setAuthed(false);
        }
      } catch {
        if (!alive) return;
        clearAllAdminSessionTokens();
        setAuthed(false);
      } finally {
        if (alive) setChecking(false);
      }
    }

    checkSession();
    return () => {
      alive = false;
    };
  }, [sessionKey, slug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      setError("Informe a senha para continuar.");
      return;
    }

    try {
      setLoading(true);
      const data = await apiPost<AdminLoginResponse>("/api/admin/login", {
        slug,
        password: trimmedPassword,
      });

      clearAllAdminSessionTokens();
      window.sessionStorage.setItem(sessionKey, data.token);
      setAuthed(true);
      setPassword("");
    } catch (err: any) {
      const raw = String(err?.message || "").trim();
      let friendly = "Falha ao autenticar.";

      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const apiError = String(parsed?.error || "").trim().toLowerCase();
          if (apiError.includes("password") && apiError.includes("obrigat")) {
            friendly = "Informe a senha para continuar.";
          } else if (
            apiError.includes("senha incorreta") ||
            apiError.includes("senha invalida") ||
            apiError.includes("senha inválida")
          ) {
            friendly = "Senha incorreta. Tente novamente.";
          } else if (apiError.includes("nao configurada") || apiError.includes("não configurada")) {
            friendly = "Senha administrativa ainda não configurada para esta empresa.";
          } else if (parsed?.error) {
            friendly = String(parsed.error);
          }
        } catch {
          const normalized = raw.toLowerCase();
          if (normalized.includes("password") && normalized.includes("obrigat")) {
            friendly = "Informe a senha para continuar.";
          } else if (
            normalized.includes("senha incorreta") ||
            normalized.includes("senha invalida") ||
            normalized.includes("senha inválida")
          ) {
            friendly = "Senha incorreta. Tente novamente.";
          } else {
            friendly = raw;
          }
        }
      }

      setError(friendly);
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6 text-white">
        Verificando acesso...
      </div>
    );
  }

  if (authed) {
    return <Navigate to={buildEmpresaPath("/admin", slug)} replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h1 className="text-xl font-semibold text-slate-900">Área Administrativa</h1>
        <p className="mt-1 text-sm text-slate-500">
          Digite a senha da empresa <b>{slug}</b> para acessar o painel
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
              disabled={loading}
            />

            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="rounded-md border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              title={showPassword ? "Ocultar" : "Mostrar"}
              data-cy="admin-toggle-password"
              disabled={loading}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>

          {error && (
            <div className="text-sm text-red-600" data-cy="admin-login-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-white hover:bg-slate-800"
            data-cy="admin-login-submit"
            disabled={loading}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
