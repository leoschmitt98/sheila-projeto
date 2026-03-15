import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";

/* =========================
   Types
========================= */

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled";

export type Appointment = {
  id: number;
  status: AppointmentStatus;
  ClienteNome: string;
  ClienteWhatsapp: string;
  Servico: string;
  HoraAgendada: string;
  DataAgendada: string;
};

export type CreateAppointmentInput = {
  serviceId?: number | null;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string;
  notes?: string;
  profissionalId?: number | null;
  customService?: {
    descricao: string;
    modelo?: string;
    duracaoMin: number;
    valorMaoObra: number;
    valorProdutos: number;
  } | null;
};

type ApiAgendamentosResponse = {
  ok: true;
  agendamentos: Appointment[];
};

/* =========================
   Hook
========================= */

export function useAppointments(empresaSlugParam?: string) {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // 🔑 fonte única da verdade para o slug
  const slug = useMemo(
    () => empresaSlugParam || resolveEmpresaSlug({ search: `?${searchParams.toString()}` }),
    [empresaSlugParam, searchParams]
  );

  /* ---------- LISTAR AGENDAMENTOS ---------- */
  const { data, isLoading } = useQuery({
    queryKey: ["appointments", slug],
    enabled: !!slug,
    queryFn: () =>
      apiGet<ApiAgendamentosResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/agendamentos`
      ),
  });

  /* ---------- CRIAR AGENDAMENTO ---------- */
  const createMutation = useMutation({
    mutationFn: async (input: CreateAppointmentInput) => {
      if (!input.clientPhone || input.clientPhone.trim().length < 8) {
        throw new Error("Telefone do cliente inválido.");
      }

      return apiPost(`/api/empresas/${encodeURIComponent(slug)}/agendamentos`, {
        servicoId: input.serviceId ?? null,
        date: input.date,
        time: input.time,
        clientName: input.clientName,
        clientPhone: input.clientPhone, // 🔥 SEM placeholder
        notes: input.notes ?? null,
        profissionalId: input.profissionalId ?? null,
        customService: input.customService ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments", slug] });
    },
  });

  /* ---------- ATUALIZAR STATUS ---------- */
  const updateStatusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: number;
      status: AppointmentStatus;
    }) => {
      return apiPut(`/api/empresas/${encodeURIComponent(slug)}/agendamentos/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments", slug] });
    },
  });

  return {
    appointments: data?.agendamentos ?? [],
    isLoading,
    createAppointment: createMutation.mutateAsync,
    updateAppointmentStatus: updateStatusMutation.mutateAsync,
  };
}
