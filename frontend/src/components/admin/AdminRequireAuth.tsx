import React from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { buildEmpresaPath, resolveEmpresaSlug } from "@/lib/getEmpresaSlug";

type AdminSessionResponse = {
  ok: true;
  session: {
    slug: string;
    empresaId: number;
    exp: number;
  };
};

export function AdminRequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const slug = React.useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const sessionKey = React.useMemo(() => `adminToken:${slug}`, [slug]);

  const [authed, setAuthed] = React.useState(false);
  const [checking, setChecking] = React.useState(true);

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
          window.sessionStorage.removeItem(sessionKey);
          setAuthed(false);
        }
      } catch {
        if (!alive) return;
        window.sessionStorage.removeItem(sessionKey);
        setAuthed(false);
      } finally {
        if (alive) setChecking(false);
      }
    }

    checkSession();
    return () => {
      alive = false;
    };
  }, [location.pathname, sessionKey, slug]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6 text-white">
        Verificando acesso...
      </div>
    );
  }

  if (!authed) {
    return <Navigate to={buildEmpresaPath("/admin/login", slug)} replace />;
  }

  return <>{children}</>;
}

