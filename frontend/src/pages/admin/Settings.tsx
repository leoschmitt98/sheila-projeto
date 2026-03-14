import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";

type EmpresaApi = {
  Id: number;
  Nome: string;
  Slug: string;
  MensagemBoasVindas: string;
  OpcoesIniciaisSheila?: string[] | null;
  WhatsappPrestador?: string | null;
  NomeProprietario?: string | null;
  Endereco?: string | null;
};


type Profissional = {
  Id: number;
  Nome: string;
  Whatsapp: string;
  Ativo: boolean;
};

type ProfissionaisResponse = {
  ok: boolean;
  profissionais: Profissional[];
};

type ServicoItem = {
  Id: number;
  Nome: string;
  Ativo?: boolean;
};

type ServicosResponse = {
  ok: boolean;
  servicos: ServicoItem[];
};

type ProfissionalHorario = {
  DiaSemana: number;
  Ativo: boolean;
  HoraInicio: string;
  HoraFim: string;
};

type EmpresaUpdatePayload = {
  Nome: string;
  MensagemBoasVindas: string;
  OpcoesIniciaisSheila: string[];
  WhatsappPrestador?: string | null;
  NomeProprietario?: string | null;
  Endereco?: string | null;
};

const CHAT_START_OPTIONS = [
  { id: "agendar", label: "Agendar serviço" },
  { id: "orcamento", label: "Solicitar orçamento" },
  { id: "servicos", label: "Ver serviços" },
  { id: "horarios", label: "Horários disponíveis" },
  { id: "cancelar", label: "Cancelar agendamento" },
  { id: "ajuda", label: "Falar com atendente" },
] as const;

const DEFAULT_CHAT_START_OPTIONS = CHAT_START_OPTIONS.map((option) => option.id);

export function Settings() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);

  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [chatStartOptions, setChatStartOptions] = useState<string[]>(DEFAULT_CHAT_START_OPTIONS);
  const [professionals, setProfessionals] = useState<Profissional[]>([]);
  const [newProfessionalName, setNewProfessionalName] = useState("");
  const [newProfessionalWhatsapp, setNewProfessionalWhatsapp] = useState("");
  const [savingProfessional, setSavingProfessional] = useState(false);
  const [services, setServices] = useState<ServicoItem[]>([]);
  const [selectedProfessionalConfigId, setSelectedProfessionalConfigId] = useState<string>("all");
  const [professionalServiceIds, setProfessionalServiceIds] = useState<number[]>([]);
  const [professionalSchedule, setProfessionalSchedule] = useState<ProfissionalHorario[]>([]);
  const [savingProfessionalConfig, setSavingProfessionalConfig] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 🔹 CARREGAR DO BANCO
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);

        const [empresaRes, profissionaisRes, servicosRes] = await Promise.allSettled([
          apiGet<EmpresaApi>(`/api/empresas/${encodeURIComponent(slug)}`),
          apiGet<ProfissionaisResponse>(`/api/empresas/${encodeURIComponent(slug)}/profissionais`),
          apiGet<ServicosResponse>(`/api/empresas/${encodeURIComponent(slug)}/servicos?all=1`),
        ]);
        if (!alive) return;

        if (empresaRes.status === "fulfilled") {
          const empresa = empresaRes.value;
          setBusinessName(empresa.Nome || "");
          setWelcomeMessage(empresa.MensagemBoasVindas || "");
          setChatStartOptions(
            Array.isArray(empresa.OpcoesIniciaisSheila) && empresa.OpcoesIniciaisSheila.length > 0
              ? empresa.OpcoesIniciaisSheila
              : DEFAULT_CHAT_START_OPTIONS
          );
          setPhone((empresa.WhatsappPrestador || "").replace(/\D/g, ""));
          setOwnerName(empresa.NomeProprietario || "");
          setAddress(empresa.Endereco || "");
        } else {
          toast.error("Não foi possível carregar os dados da empresa.");
        }

        if (profissionaisRes.status === "fulfilled") {
          const profissionaisResp = profissionaisRes.value;
          const list = Array.isArray(profissionaisResp.profissionais) ? profissionaisResp.profissionais : [];
          setProfessionals(list);
          if (list.length > 0 && selectedProfessionalConfigId === "all") {
            setSelectedProfessionalConfigId(String(list[0].Id));
          }
        } else {
          setProfessionals([]);
        }

        if (servicosRes.status === "fulfilled") {
          setServices(Array.isArray(servicosRes.value.servicos) ? servicosRes.value.servicos : []);
        } else {
          setServices([]);
        }
      } catch {
        toast.error("Não foi possível carregar as configurações da empresa.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [slug]);


  const loadProfessionals = async () => {
    const resp = await apiGet<ProfissionaisResponse>(`/api/empresas/${encodeURIComponent(slug)}/profissionais`);
    setProfessionals(Array.isArray(resp.profissionais) ? resp.profissionais : []);
  };

  const handleAddProfessional = async () => {
    const nome = newProfessionalName.trim();
    const whatsapp = newProfessionalWhatsapp.replace(/\D/g, "").slice(0, 20);
    if (!nome || !whatsapp) return;

    try {
      setSavingProfessional(true);
      await apiPost(`/api/empresas/${encodeURIComponent(slug)}/profissionais`, { Nome: nome, Whatsapp: whatsapp, Ativo: true });
      setNewProfessionalName("");
      setNewProfessionalWhatsapp("");
      await loadProfessionals();
      toast.success("Profissional adicionado.");
    } catch {
      toast.error("Não foi possível adicionar o profissional.");
    } finally {
      setSavingProfessional(false);
    }
  };

  const handleToggleProfessional = async (professional: Profissional, checked: boolean) => {
    try {
      setSavingProfessional(true);
      await apiPut(`/api/empresas/${encodeURIComponent(slug)}/profissionais/${professional.Id}`, {
        Nome: professional.Nome,
        Whatsapp: professional.Whatsapp,
        Ativo: checked,
      });
      await loadProfessionals();
    } catch {
      toast.error("Não foi possível atualizar o profissional.");
    } finally {
      setSavingProfessional(false);
    }
  };

  const handleDeleteProfessional = async (professionalId: number) => {
    try {
      setSavingProfessional(true);
      await apiDelete(`/api/empresas/${encodeURIComponent(slug)}/profissionais/${professionalId}`);
      await loadProfessionals();
      toast.success("Profissional removido.");
    } catch {
      toast.error("Não foi possível remover o profissional.");
    } finally {
      setSavingProfessional(false);
    }
  };


  const selectedProfessional = professionals.find((p) => String(p.Id) === String(selectedProfessionalConfigId));

  const loadProfessionalConfig = async (professionalId: number) => {
    try {
      const [servicesResp, scheduleResp] = await Promise.all([
        apiGet<{ ok: boolean; servicoIds: number[] }>(`/api/empresas/${encodeURIComponent(slug)}/profissionais/${professionalId}/servicos`),
        apiGet<{ ok: boolean; horarios: ProfissionalHorario[] }>(`/api/empresas/${encodeURIComponent(slug)}/profissionais/${professionalId}/horarios`),
      ]);

      setProfessionalServiceIds(Array.isArray(servicesResp.servicoIds) ? servicesResp.servicoIds : []);

      const incoming = Array.isArray(scheduleResp.horarios) ? scheduleResp.horarios : [];
      const byDay = new Map(incoming.map((h) => [Number(h.DiaSemana), h]));
      const full = Array.from({ length: 7 }).map((_, day) => {
        const cur = byDay.get(day);
        return {
          DiaSemana: day,
          Ativo: cur ? Boolean(cur.Ativo) : day !== 0,
          HoraInicio: cur?.HoraInicio ? String(cur.HoraInicio).slice(0, 5) : "09:00",
          HoraFim: cur?.HoraFim ? String(cur.HoraFim).slice(0, 5) : "18:00",
        };
      });
      setProfessionalSchedule(full);
    } catch {
      setProfessionalServiceIds([]);
      setProfessionalSchedule([]);
    }
  };

  useEffect(() => {
    const id = Number(selectedProfessionalConfigId);
    if (!Number.isFinite(id) || id <= 0) {
      setProfessionalServiceIds([]);
      setProfessionalSchedule([]);
      return;
    }
    loadProfessionalConfig(id);
  }, [selectedProfessionalConfigId, slug]);

  const toggleProfessionalService = (serviceId: number, checked: boolean) => {
    setProfessionalServiceIds((prev) => {
      if (checked) return [...new Set([...prev, serviceId])];
      return prev.filter((id) => id !== serviceId);
    });
  };

  const updateProfessionalScheduleDay = (day: number, patch: Partial<ProfissionalHorario>) => {
    setProfessionalSchedule((prev) => prev.map((d) => (d.DiaSemana === day ? { ...d, ...patch } : d)));
  };

  const saveProfessionalConfig = async () => {
    const id = Number(selectedProfessionalConfigId);
    if (!Number.isFinite(id) || id <= 0) return;

    try {
      setSavingProfessionalConfig(true);
      await Promise.all([
        apiPut(`/api/empresas/${encodeURIComponent(slug)}/profissionais/${id}/servicos`, {
          servicoIds: professionalServiceIds,
        }),
        apiPut(`/api/empresas/${encodeURIComponent(slug)}/profissionais/${id}/horarios`, {
          horarios: professionalSchedule,
        }),
      ]);
      toast.success("Configurações do profissional salvas.");
    } catch {
      toast.error("Não foi possível salvar serviços/horários do profissional.");
    } finally {
      setSavingProfessionalConfig(false);
    }
  };

  // 🔹 SALVAR NO BANCO
  const handleSave = async () => {
    try {
      setSaving(true);

      const payload: EmpresaUpdatePayload = {
        Nome: businessName.trim(),
        MensagemBoasVindas: welcomeMessage.trim(),
        OpcoesIniciaisSheila: chatStartOptions,
        WhatsappPrestador: phone ? phone.replace(/\D/g, "") : null,
        NomeProprietario: ownerName.trim() || null,
        Endereco: address.trim() || null,
      };

      await apiPut(`/api/empresas/${encodeURIComponent(slug)}`, payload);

      toast.success("Configurações salvas com sucesso!");
    } catch {
      toast.error("Falha ao salvar no banco. Verifique a API.");
    } finally {
      setSaving(false);
    }
  };

  const toggleChatStartOption = (optionId: string, checked: boolean) => {
    setChatStartOptions((prev) => {
      if (checked) return [...new Set([...prev, optionId])];
      return prev.filter((id) => id !== optionId);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Configurações</h1>
        <p className="text-muted-foreground mt-1">Configure as informações da sua empresa</p>
        <p className="text-xs text-muted-foreground mt-1">
          Empresa atual: <b className="text-foreground">{slug}</b>
        </p>
      </div>

      <div className="glass-card p-6 max-w-2xl space-y-6">
        <div>
          <Label>Nome da Empresa</Label>
          <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} disabled={loading || saving} />
        </div>

        <div>
          <Label>Mensagem de Boas-vindas da Sheila</Label>
          <Textarea value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} rows={3} disabled={loading || saving} />
        </div>

        <div className="space-y-3">
          <Label>Opções iniciais do chat</Label>
          <p className="text-xs text-muted-foreground">Escolha quais atalhos aparecem no início da Sheila.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CHAT_START_OPTIONS.map((option) => {
              const checked = chatStartOptions.includes(option.id);

              return (
                <label key={option.id} className="flex items-center gap-3 rounded-md border border-border/60 p-3 cursor-pointer">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => toggleChatStartOption(option.id, value === true)}
                    disabled={loading || saving}
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>


        <div className="space-y-3">
          <Label>Profissionais (opcional)</Label>
          <p className="text-xs text-muted-foreground">
            Cadastre profissionais apenas se sua empresa tiver mais de um atendente. Com 0 ou 1 profissional, o fluxo segue como hoje.
          </p>

          <div className="space-y-2">
            {professionals.map((professional) => (
              <div key={professional.Id} className="flex items-center gap-3 rounded-md border border-border/60 p-3">
                <Checkbox
                  checked={professional.Ativo !== false}
                  onCheckedChange={(value) => handleToggleProfessional(professional, value === true)}
                  disabled={loading || saving || savingProfessional}
                />
                <div className="text-sm flex-1">
                  <p className="font-medium">{professional.Nome}</p>
                  <p className="text-xs text-muted-foreground">{professional.Whatsapp}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteProfessional(professional.Id)}
                  disabled={loading || saving || savingProfessional}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              value={newProfessionalName}
              onChange={(e) => setNewProfessionalName(e.target.value)}
              placeholder="Nome do profissional"
              disabled={loading || saving || savingProfessional}
              className="sm:col-span-1"
            />
            <Input
              value={newProfessionalWhatsapp}
              onChange={(e) => setNewProfessionalWhatsapp(e.target.value.replace(/\D/g, ""))}
              placeholder="WhatsApp com DDD"
              disabled={loading || saving || savingProfessional}
              className="sm:col-span-1"
            />
            <Button type="button" onClick={handleAddProfessional} disabled={loading || saving || savingProfessional || !newProfessionalName.trim() || !newProfessionalWhatsapp.trim()}>
              <Plus size={16} className="mr-2" />
              Adicionar
            </Button>
          </div>
        </div>


        {professionals.length > 0 && (
          <div className="space-y-4 rounded-md border border-border/60 p-4">
            <Label>Configuração por profissional (opcional)</Label>
            <p className="text-xs text-muted-foreground">
              Para empresas com equipe, defina serviços e horários específicos por profissional.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Profissional</Label>
                <select
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                  value={selectedProfessionalConfigId}
                  onChange={(e) => setSelectedProfessionalConfigId(e.target.value)}
                >
                  {professionals.map((p) => (
                    <option key={p.Id} value={String(p.Id)}>{p.Nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Contato</Label>
                <div className="mt-1 rounded-md border border-border/60 p-2 text-sm text-muted-foreground">
                  {selectedProfessional?.Whatsapp || "—"}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Serviços executados</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {services.filter((svc) => svc.Ativo !== false).map((svc) => (
                  <label key={svc.Id} className="flex items-center gap-2 rounded border border-border/60 p-2">
                    <Checkbox
                      checked={professionalServiceIds.includes(svc.Id)}
                      onCheckedChange={(value) => toggleProfessionalService(svc.Id, value === true)}
                    />
                    <span className="text-sm">{svc.Nome}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Horários do profissional</Label>
              <div className="space-y-2">
                {professionalSchedule.map((d) => (
                  <div key={d.DiaSemana} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center rounded border border-border/60 p-2">
                    <div className="text-sm">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d.DiaSemana]}</div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={d.Ativo} onCheckedChange={(v) => updateProfessionalScheduleDay(d.DiaSemana, { Ativo: v === true })} />
                      Ativo
                    </label>
                    <Input type="time" value={d.HoraInicio} onChange={(e) => updateProfessionalScheduleDay(d.DiaSemana, { HoraInicio: e.target.value })} disabled={!d.Ativo} />
                    <Input type="time" value={d.HoraFim} onChange={(e) => updateProfessionalScheduleDay(d.DiaSemana, { HoraFim: e.target.value })} disabled={!d.Ativo} />
                  </div>
                ))}
              </div>
            </div>

            <Button type="button" variant="outline" onClick={saveProfessionalConfig} disabled={savingProfessionalConfig}>
              {savingProfessionalConfig ? "Salvando configuração..." : "Salvar configuração do profissional"}
            </Button>
          </div>
        )}

        <div>
          <Label>WhatsApp do Prestador</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} disabled={loading || saving} />
        </div>

        <div>
          <Label>Nome do Proprietário</Label>
          <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} disabled={loading || saving} />
        </div>

        <div>
          <Label>Endereço</Label>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} disabled={loading || saving} />
        </div>

        <Button onClick={handleSave} disabled={loading || saving || chatStartOptions.length === 0}>
          <Save size={18} className="mr-2" />
          {saving ? "Salvando..." : "Salvar Configurações"}
        </Button>

        {chatStartOptions.length === 0 && (
          <p className="text-xs text-destructive">Selecione pelo menos uma opção inicial para a Sheila.</p>
        )}
      </div>
    </div>
  );
}
