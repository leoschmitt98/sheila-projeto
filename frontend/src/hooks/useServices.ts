import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Service } from "@/types/database";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";

/**
 * Hook para gerenciar serviços (SQL via API)
 * - Lista:    GET    /api/empresas/:slug/servicos
 * - Criar:    POST   /api/empresas/:slug/servicos
 * - Editar:   PUT    /api/servicos/:id
 * - Excluir:  DELETE /api/servicos/:id
 */
export function useServices() {
  const [searchParams] = useSearchParams();

  const slug = useMemo(() => {
    return resolveEmpresaSlug({ search: `?${searchParams.toString()}` });
  }, [searchParams]);

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  const normalizeFromApi = (row: any): Service => {
    // aceita tanto padrão SQL (Id/Nome/...) quanto padrão frontend (id/name/...)
    const id = row?.Id ?? row?.id;

    return {
      id: String(id),
      name: row?.Nome ?? row?.name ?? "",
      description: row?.Descricao ?? row?.description ?? "",
      duration: Number(row?.DuracaoMin ?? row?.duration ?? 0),
      price: Number(row?.Preco ?? row?.price ?? 0),
      active: Boolean(row?.Ativo ?? row?.active ?? true),
      createdAt: row?.CriadoEm ? new Date(row.CriadoEm) : new Date(),
      updatedAt: row?.AtualizadoEm ? new Date(row.AtualizadoEm) : new Date(),
    };
  };

  const loadServices = async () => {
    try {
      setLoading(true);

      const data = await apiGet<{ ok: boolean; servicos: any[] }>(
        `/api/empresas/${encodeURIComponent(slug)}/servicos`
      );

      const list = Array.isArray(data?.servicos)
        ? data.servicos.map(normalizeFromApi)
        : [];

      setServices(list);
    } catch (e) {
      console.error("loadServices error:", e);
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, [slug]);

  const addService = async (service: Omit<Service, "id" | "createdAt" | "updatedAt">) => {
    const payload = {
      Nome: service.name,
      Descricao: service.description,
      DuracaoMin: service.duration,
      Preco: service.price,
      Ativo: service.active,
    };

    const resp = await apiPost<{ ok: boolean; servico: any }>(
      `/api/empresas/${encodeURIComponent(slug)}/servicos`,
      payload
    );

    const created = normalizeFromApi(resp.servico);
    setServices((prev) => [...prev, created]);
    return created;
  };

  const updateService = async (id: string, data: Partial<Service>) => {
    if (!id) throw new Error("Id inválido.");

    const payload: any = {};
    if (data.name !== undefined) payload.Nome = data.name;
    if (data.description !== undefined) payload.Descricao = data.description;
    if (data.duration !== undefined) payload.DuracaoMin = data.duration;
    if (data.price !== undefined) payload.Preco = data.price;
    if (data.active !== undefined) payload.Ativo = data.active;

    const resp = await apiPut<{ ok: boolean; servico: any }>(
      `/api/empresas/${encodeURIComponent(slug)}/servicos/${encodeURIComponent(id)}`,
      payload
    );

    const updated = normalizeFromApi(resp.servico);
    setServices((prev) => prev.map((s) => (s.id === id ? updated : s)));
  };

  const deleteService = async (id: string) => {
    if (!id) throw new Error("Id inválido.");

    await apiDelete(`/api/empresas/${encodeURIComponent(slug)}/servicos/${encodeURIComponent(id)}`);

    // remove da tela sem precisar recarregar
    setServices((prev) => prev.filter((s) => s.id !== id));
  };


  const getActiveServices = () => services.filter((s) => s.active);

  return {
    services,
    loading,
    addService,
    updateService,
    deleteService,
    getActiveServices,
    refresh: loadServices,
  };
}
