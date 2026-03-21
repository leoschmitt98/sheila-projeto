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

type EmpresaUpdatePayload = {
  Nome: string;
  MensagemBoasVindas: string;
  OpcoesIniciaisSheila: string[];
  WhatsappPrestador?: string | null;
  NomeProprietario?: string | null;
  Endereco?: string | null;
};

type NotificationDevice = {
  Id: number;
  EmpresaId: number;
  DeviceId: string;
  NomeDispositivo: string;
  Endpoint: string | null;
  Auth: string | null;
  P256dh: string | null;
  RecebePushAgendamento?: boolean;
  RecebePushLembrete?: boolean;
  Ativo: boolean;
  CriadoEm: string | null;
  AtualizadoEm: string | null;
  ProfissionalIds?: number[];
};

type NotificationDevicesResponse = {
  ok: boolean;
  dispositivos: NotificationDevice[];
};

type NotificationDeviceMutationResponse = {
  ok: boolean;
  dispositivo: NotificationDevice;
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
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const PUSH_SW_URL = "/push-sw.js";
const PUSH_SW_SCOPE = "/admin/";

function getAdminDeviceStorageKey(slug: string) {
  return `adminNotificationDeviceId:${slug}`;
}

function getAdminDeviceId(slug: string) {
  const storageKey = getAdminDeviceStorageKey(slug);
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;

  const generated =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  window.localStorage.setItem(storageKey, generated);
  return generated;
}

function getDefaultDeviceName() {
  const platform = window.navigator.platform?.trim() || "dispositivo";
  return `Admin ${platform}`;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(normalized);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function registerPushServiceWorker() {
  return navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_SCOPE });
}

export function Settings() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const sessionKey = useMemo(() => `adminToken:${slug}`, [slug]);

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
  const [savingProfessionalConfig, setSavingProfessionalConfig] = useState(false);
  const [notificationDevices, setNotificationDevices] = useState<NotificationDevice[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [savingDevice, setSavingDevice] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [preparingPush, setPreparingPush] = useState(false);
  const [selectedNotificationProfessionalIds, setSelectedNotificationProfessionalIds] = useState<number[]>([]);
  const [receivePushAgendamento, setReceivePushAgendamento] = useState(true);
  const [receivePushLembrete, setReceivePushLembrete] = useState(true);

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

  useEffect(() => {
    setDeviceName(getDefaultDeviceName());
  }, []);

  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;

    if (!supported) {
      setPushPermission("unsupported");
      return;
    }

    setPushPermission(Notification.permission);
  }, []);

  const loadNotificationDevices = async () => {
    const token = window.sessionStorage.getItem(sessionKey);
    if (!token) {
      setNotificationDevices([]);
      return;
    }

    setLoadingDevices(true);
    try {
      const response = await apiGet<NotificationDevicesResponse>("/api/admin/notificacoes/dispositivos", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setNotificationDevices(Array.isArray(response.dispositivos) ? response.dispositivos : []);
    } catch {
      toast.error("Nao foi possivel carregar os dispositivos de notificacao.");
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    loadNotificationDevices();
  }, [sessionKey]);

  const persistCurrentDeviceNotificationPreferences = async (next: {
    recebePushAgendamento: boolean;
    recebePushLembrete: boolean;
  }) => {
    const token = window.sessionStorage.getItem(sessionKey);
    if (!token || !currentDevice) return;

    try {
      setSavingDevice(true);
      const response = await fetch(`${API_BASE}/api/admin/notificacoes/dispositivos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          deviceId: currentDevice.DeviceId,
          nomeDispositivo: currentDevice.NomeDispositivo,
          endpoint: currentDevice.Endpoint,
          auth: currentDevice.Auth,
          p256dh: currentDevice.P256dh,
          profissionalIds: selectedNotificationProfessionalIds,
          recebePushAgendamento: next.recebePushAgendamento,
          recebePushLembrete: next.recebePushLembrete,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data: NotificationDeviceMutationResponse = await response.json();
      setNotificationDevices((prev) => {
        const nextDevices = prev.filter((item) => item.Id !== data.dispositivo.Id);
        return [data.dispositivo, ...nextDevices];
      });
      toast.success("Preferencias de notificacao salvas com sucesso.");
    } catch {
      toast.error("Nao foi possivel salvar as preferencias de notificacao.");
      setReceivePushAgendamento(Boolean(currentDevice.RecebePushAgendamento ?? true));
      setReceivePushLembrete(Boolean(currentDevice.RecebePushLembrete ?? true));
    } finally {
      setSavingDevice(false);
    }
  };


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
      const servicesResp = await apiGet<{ ok: boolean; servicoIds: number[] }>(
        `/api/empresas/${encodeURIComponent(slug)}/profissionais/${professionalId}/servicos`
      );
      setProfessionalServiceIds(Array.isArray(servicesResp.servicoIds) ? servicesResp.servicoIds : []);
    } catch {
      setProfessionalServiceIds([]);
    }
  };

  useEffect(() => {
    const id = Number(selectedProfessionalConfigId);
    if (!Number.isFinite(id) || id <= 0) {
      setProfessionalServiceIds([]);
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

  const saveProfessionalConfig = async () => {
    const id = Number(selectedProfessionalConfigId);
    if (!Number.isFinite(id) || id <= 0) return;

    try {
      setSavingProfessionalConfig(true);
      await apiPut(`/api/empresas/${encodeURIComponent(slug)}/profissionais/${id}/servicos`, {
        servicoIds: professionalServiceIds,
      });

      toast.success("Serviços do profissional salvos.");
    } catch {
      toast.error("Não foi possível salvar os serviços do profissional.");
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

  const handleActivateCurrentDevice = async () => {
    const token = window.sessionStorage.getItem(sessionKey);
    if (!token) {
      toast.error("Sessao do admin nao encontrada.");
      return;
    }

    const nomeDispositivo = deviceName.trim();
    if (!nomeDispositivo) {
      toast.error("Informe um nome para este dispositivo.");
      return;
    }
    if (hasMultipleNotificationProfessionals && selectedNotificationProfessionalIds.length === 0) {
      toast.error("Selecione pelo menos um profissional para este dispositivo.");
      return;
    }

    try {
      setSavingDevice(true);
      const response = await fetch(`${API_BASE}/api/admin/notificacoes/dispositivos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          deviceId: getAdminDeviceId(slug),
          nomeDispositivo,
          profissionalIds: selectedNotificationProfessionalIds,
          recebePushAgendamento: receivePushAgendamento,
          recebePushLembrete: receivePushLembrete,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data: NotificationDeviceMutationResponse = await response.json();
      setNotificationDevices((prev) => {
        const next = prev.filter((item) => item.Id !== data.dispositivo.Id);
        return [data.dispositivo, ...next];
      });
      toast.success("Dispositivo ativado para notificacoes futuras.");
    } catch {
      toast.error("Nao foi possivel ativar este dispositivo.");
    } finally {
      setSavingDevice(false);
    }
  };

  const handleDeactivateDevice = async (deviceId: number) => {
    const token = window.sessionStorage.getItem(sessionKey);
    if (!token) {
      toast.error("Sessao do admin nao encontrada.");
      return;
    }

    try {
      setSavingDevice(true);
      const response = await fetch(`${API_BASE}/api/admin/notificacoes/dispositivos/${deviceId}/desativar`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data: NotificationDeviceMutationResponse = await response.json();
      setNotificationDevices((prev) =>
        prev.map((item) => (item.Id === data.dispositivo.Id ? data.dispositivo : item))
      );
      toast.success("Dispositivo desativado.");
    } catch {
      toast.error("Nao foi possivel desativar o dispositivo.");
    } finally {
      setSavingDevice(false);
    }
  };

  const handlePrepareCurrentDeviceForPush = async () => {
    const token = window.sessionStorage.getItem(sessionKey);
    if (!token) {
      toast.error("Sessao do admin nao encontrada.");
      return;
    }

    const vapidPublicKey = String(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || "").trim();
    if (!vapidPublicKey) {
      toast.error("Configure VITE_WEB_PUSH_PUBLIC_KEY no frontend para preparar o push.");
      return;
    }

    const supported =
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;

    if (!supported) {
      setPushPermission("unsupported");
      toast.error("Este navegador nao suporta notificacoes push.");
      return;
    }

    const nomeDispositivo = deviceName.trim();
    if (!nomeDispositivo) {
      toast.error("Informe um nome para este dispositivo.");
      return;
    }
    if (hasMultipleNotificationProfessionals && selectedNotificationProfessionalIds.length === 0) {
      toast.error("Selecione pelo menos um profissional para este dispositivo.");
      return;
    }

    try {
      setPreparingPush(true);

      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== "granted") {
        toast.error(
          permission === "denied"
            ? "As notificações estão bloqueadas neste navegador. Libere nas configurações do site para continuar."
            : "Permissão não concedida."
        );
        return;
      }

      const registration = await registerPushServiceWorker();
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      const subscriptionJson = subscription.toJSON();
      const auth =
        subscriptionJson.keys?.auth ||
        (subscription.getKey("auth")
          ? window.btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("auth")!)))
          : null);
      const p256dh =
        subscriptionJson.keys?.p256dh ||
        (subscription.getKey("p256dh")
          ? window.btoa(String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")!)))
          : null);

      const response = await fetch(`${API_BASE}/api/admin/notificacoes/dispositivos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          deviceId: getAdminDeviceId(slug),
          nomeDispositivo,
          endpoint: subscription.endpoint,
          auth,
          p256dh,
          profissionalIds: selectedNotificationProfessionalIds,
          recebePushAgendamento: receivePushAgendamento,
          recebePushLembrete: receivePushLembrete,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data: NotificationDeviceMutationResponse = await response.json();
      setNotificationDevices((prev) => {
        const next = prev.filter((item) => item.Id !== data.dispositivo.Id);
        return [data.dispositivo, ...next];
      });

      toast.success("Dispositivo preparado para notificacoes futuras.");
    } catch {
      toast.error("Nao foi possivel preparar este dispositivo para push.");
    } finally {
      setPreparingPush(false);
    }
  };

  const currentDeviceId = getAdminDeviceId(slug);
  const currentDevice = notificationDevices.find((device) => device.DeviceId === currentDeviceId) || null;
  const currentDeviceRegistered = Boolean(currentDevice);
  const currentDeviceReady = Boolean(currentDevice?.Ativo && currentDevice?.Endpoint && currentDevice?.Auth && currentDevice?.P256dh);
  const activeNotificationProfessionals = useMemo(
    () => professionals.filter((professional) => professional.Ativo),
    [professionals]
  );
  const hasMultipleNotificationProfessionals = activeNotificationProfessionals.length > 1;

  useEffect(() => {
    if (!hasMultipleNotificationProfessionals) {
      setSelectedNotificationProfessionalIds([]);
      return;
    }

    setSelectedNotificationProfessionalIds(Array.isArray(currentDevice?.ProfissionalIds) ? currentDevice.ProfissionalIds : []);
  }, [currentDevice?.Id, currentDevice?.ProfissionalIds, hasMultipleNotificationProfessionals]);

  useEffect(() => {
    setReceivePushAgendamento(Boolean(currentDevice?.RecebePushAgendamento ?? true));
    setReceivePushLembrete(Boolean(currentDevice?.RecebePushLembrete ?? true));
  }, [currentDevice?.Id, currentDevice?.RecebePushAgendamento, currentDevice?.RecebePushLembrete]);

  const toggleNotificationProfessional = (professionalId: number, checked: boolean) => {
    setSelectedNotificationProfessionalIds((prev) => {
      if (checked) return [...new Set([...prev, professionalId])];
      return prev.filter((id) => id !== professionalId);
    });
  };

  const handleToggleDevicePushPreference = async (
    field: "agendamento" | "lembrete",
    checked: boolean
  ) => {
    const next = {
      recebePushAgendamento: field === "agendamento" ? checked : receivePushAgendamento,
      recebePushLembrete: field === "lembrete" ? checked : receivePushLembrete,
    };

    setReceivePushAgendamento(next.recebePushAgendamento);
    setReceivePushLembrete(next.recebePushLembrete);

    if (currentDeviceRegistered) {
      await persistCurrentDeviceNotificationPreferences(next);
    }
  };

  let pushStatusLabel = "Permissao nao concedida";
  if (pushPermission === "unsupported") {
    pushStatusLabel = "Navegador sem suporte a push";
  } else if (pushPermission === "denied") {
    pushStatusLabel = "Permissao negada";
  } else if (currentDeviceReady) {
    pushStatusLabel = "Dispositivo preparado para notificacoes";
  } else if (pushPermission === "granted") {
    pushStatusLabel = "Permissao concedida, aguardando subscription";
  }
  const pushStatusHelpText =
    pushPermission === "denied"
      ? "As notificações estão bloqueadas neste navegador. Para ativar, libere as notificações nas configurações do site."
      : pushPermission === "unsupported"
        ? "Este navegador não oferece suporte a notificações push."
        : "";

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
              Para empresas com equipe, defina quais serviços cada profissional executa.
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

            <Button type="button" variant="outline" onClick={saveProfessionalConfig} disabled={savingProfessionalConfig}>
              {savingProfessionalConfig ? "Salvando..." : "Salvar serviços do profissional"}
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

        <div className="space-y-4 rounded-md border border-border/60 p-4">
          <div>
            <Label>Notificacoes neste aparelho</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Escolha quais alertas voce deseja receber neste dispositivo.
            </p>
          </div>

          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
            <p className="font-medium">Status deste navegador</p>
            <p className="mt-1 text-muted-foreground">{pushStatusLabel}</p>
            {pushStatusHelpText ? (
              <p className="mt-2 text-xs text-muted-foreground">{pushStatusHelpText}</p>
            ) : null}
          </div>

          {hasMultipleNotificationProfessionals && (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <div>
                <p className="text-sm font-medium">Receber notificacoes de quais profissionais?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Marque um ou mais nomes. Assim cada dispositivo pode receber apenas os agendamentos desejados.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {activeNotificationProfessionals.map((professional) => (
                  <label
                    key={professional.Id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 p-3"
                  >
                    <Checkbox
                      checked={selectedNotificationProfessionalIds.includes(professional.Id)}
                      onCheckedChange={(value) => toggleNotificationProfessional(professional.Id, value === true)}
                      disabled={loadingDevices || savingDevice || preparingPush}
                    />
                    <span className="text-sm">{professional.Nome}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {currentDeviceRegistered ? (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <p className="text-sm font-medium">Preferencias de push</p>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 p-3">
                  <Checkbox
                    checked={receivePushAgendamento}
                    onCheckedChange={(value) => handleToggleDevicePushPreference("agendamento", value === true)}
                    disabled={savingDevice || preparingPush}
                  />
                  <span className="text-sm">Receber push de novos agendamentos</span>
                </label>
                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 p-3">
                  <Checkbox
                    checked={receivePushLembrete}
                    onCheckedChange={(value) => handleToggleDevicePushPreference("lembrete", value === true)}
                    disabled={savingDevice || preparingPush}
                  />
                  <span className="text-sm">Receber push de lembretes da Sheila para avisar o cliente</span>
                </label>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
              Ao registrar este aparelho pela primeira vez, os dois tipos de push serao ativados por padrao. Depois voce podera ajustar as preferencias individualmente.
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Ex.: Computador recepcao"
              disabled={loadingDevices || savingDevice || preparingPush}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleActivateCurrentDevice}
              disabled={
                loadingDevices ||
                savingDevice ||
                preparingPush ||
                !deviceName.trim() ||
                (hasMultipleNotificationProfessionals && selectedNotificationProfessionalIds.length === 0)
              }
            >
              {savingDevice ? "Salvando..." : "Ativar notificacoes neste dispositivo"}
            </Button>
            <Button
              type="button"
              onClick={handlePrepareCurrentDeviceForPush}
              disabled={
                loadingDevices ||
                savingDevice ||
                preparingPush ||
                !deviceName.trim() ||
                (hasMultipleNotificationProfessionals && selectedNotificationProfessionalIds.length === 0)
              }
            >
              {preparingPush ? "Preparando..." : "Permitir e preparar push"}
            </Button>
          </div>

          <div className="space-y-2">
            {loadingDevices ? (
              <p className="text-sm text-muted-foreground">Carregando dispositivos...</p>
            ) : notificationDevices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dispositivo cadastrado no momento.</p>
            ) : (
              notificationDevices.map((device) => (
                <div key={device.Id} className="flex items-center gap-3 rounded-md border border-border/60 p-3">
                  <div className="flex-1 text-sm">
                    <p className="font-medium">{device.NomeDispositivo}</p>
                    <p className="text-xs text-muted-foreground">
                      {device.Ativo ? "Ativo" : "Inativo"}
                      {device.AtualizadoEm ? ` • atualizado em ${device.AtualizadoEm}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Array.isArray(device.ProfissionalIds) && device.ProfissionalIds.length > 0
                        ? `Profissionais: ${device.ProfissionalIds
                            .map((id) => professionals.find((professional) => professional.Id === id)?.Nome || `#${id}`)
                            .join(", ")}`
                        : hasMultipleNotificationProfessionals
                          ? "Profissionais: todos os profissionais da empresa"
                          : "Profissionais: fluxo geral da empresa"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Preferencias: {device.RecebePushAgendamento !== false ? "agendamentos" : ""}
                      {device.RecebePushAgendamento !== false && device.RecebePushLembrete !== false ? " + " : ""}
                      {device.RecebePushLembrete !== false ? "lembretes" : ""}
                      {device.RecebePushAgendamento === false && device.RecebePushLembrete === false ? "nenhum push habilitado" : ""}
                    </p>
                    {device.DeviceId === currentDeviceId && (
                      <p className="text-xs text-muted-foreground">
                        {device.Endpoint && device.Auth && device.P256dh
                          ? "Subscription salva neste navegador."
                          : "Subscription ainda nao registrada neste navegador."}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleDeactivateDevice(device.Id)}
                    disabled={savingDevice || preparingPush || !device.Ativo}
                  >
                    {device.Ativo ? "Desativar" : "Desativado"}
                  </Button>
                </div>
              ))
            )}
          </div>
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
