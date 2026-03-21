import React from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { buildEmpresaPath, resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { clearAllAdminSessionTokens } from "@/lib/adminSession";

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
  const searchRaw = searchParams.toString();

  const checkSession = React.useCallback(async () => {
    const token = window.sessionStorage.getItem(sessionKey);
    if (!token) {
      setAuthed(false);
      setChecking(false);
      return;
    }

    try {
      const data = await apiGet<AdminSessionResponse>("/api/admin/session", {
        headers: { Authorization: `Bearer ${token}` },
      } as RequestInit);

      if (data?.session?.slug === slug) {
        setAuthed(true);
      } else {
        clearAllAdminSessionTokens();
        setAuthed(false);
      }
    } catch {
      clearAllAdminSessionTokens();
      setAuthed(false);
    } finally {
      setChecking(false);
    }
  }, [sessionKey, slug]);

  React.useLayoutEffect(() => {
    setChecking(true);
  }, [location.key, searchRaw, sessionKey, slug]);

  React.useEffect(() => {
    let alive = true;

    checkSession().catch(() => {
      if (!alive) return;
      setAuthed(false);
      setChecking(false);
    });

    const handlePopState = () => {
      if (!alive) return;
      setChecking(true);
      checkSession().catch(() => {
        if (!alive) return;
        setAuthed(false);
        setChecking(false);
      });
    };

    const handleVisibility = () => {
      if (!alive || document.visibilityState !== "visible") return;
      setChecking(true);
      checkSession().catch(() => {
        if (!alive) return;
        setAuthed(false);
        setChecking(false);
      });
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (!alive) return;
      if (event.persisted) {
        setChecking(true);
      }
      checkSession().catch(() => {
        if (!alive) return;
        setAuthed(false);
        setChecking(false);
      });
    };

    window.addEventListener("popstate", handlePopState);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      alive = false;
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [checkSession, location.key, searchRaw]);

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
