import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export type AdminProfessional = {
  Id: number;
  Nome: string;
  Whatsapp?: string | null;
  Ativo: boolean;
};

type ApiResp = { ok: boolean; profissionais: AdminProfessional[] };

const EVT = "admin-professional-context-change";

export function useAdminProfessionalContext(slug: string) {
  const key = `adminProfessionalContext:${slug}`;
  const [selected, setSelected] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem(key) || "all";
  });

  const { data } = useQuery({
    queryKey: ["admin-prof-context-profissionais", slug],
    enabled: !!slug,
    queryFn: () => apiGet<ApiResp>(`/api/empresas/${encodeURIComponent(slug)}/profissionais?ativos=1`),
  });

  const activeProfessionals = useMemo(
    () => (data?.profissionais ?? []).filter((p) => p.Ativo !== false),
    [data?.profissionais]
  );

  const hasMulti = activeProfessionals.length > 1;

  useEffect(() => {
    const sync = () => {
      const next = localStorage.getItem(key) || "all";
      setSelected(next);
    };
    window.addEventListener("storage", sync);
    window.addEventListener(EVT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVT, sync);
    };
  }, [key]);

  useEffect(() => {
    if (!hasMulti && selected !== "all") {
      localStorage.setItem(key, "all");
      setSelected("all");
    }
  }, [hasMulti, key, selected]);

  const setSelectedProfessionalId = (value: string) => {
    const safe = value || "all";
    localStorage.setItem(key, safe);
    setSelected(safe);
    window.dispatchEvent(new Event(EVT));
  };

  const selectedProfessionalId = hasMulti ? selected : "all";
  const profissionalIdParam = selectedProfessionalId !== "all" ? selectedProfessionalId : "";

  return {
    activeProfessionals,
    hasMulti,
    selectedProfessionalId,
    profissionalIdParam,
    setSelectedProfessionalId,
  };
}
