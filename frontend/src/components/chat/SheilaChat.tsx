import { useEffect, useMemo, useRef, useState } from "react";
import { SheilaAvatar } from "./SheilaAvatar";
import { ChatMessage } from "./ChatMessage";
import { ChatOptions, ChatOption } from "./ChatOptions";
import { ServiceCard } from "./ServiceCard";
import { DateTimePicker } from "./DateTimePicker";
import { ClientForm } from "./ClientForm";
import { BookingConfirmation } from "./BookingConfirmation";
import { VoiceButton, type VoiceInterpretResponse } from "@/features/voice/VoiceButton";
import { useServices } from "@/hooks/useServices";
import { useAppointments } from "@/hooks/useAppointments";
import { Service } from "@/types/database";
import { Calendar, Wrench, Clock, HelpCircle, ClipboardList, Send, CheckCircle2, CircleDashed, XCircle, BadgeCheck } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api";
import { getEmpresaSlug } from "@/lib/getEmpresaSlug";

type ChatStep =
  | "welcome"
  | "menu"
  | "services"
  | "chooseProfessional"
  | "selectDate"
  | "clientInfo"
  | "confirmation"
  | "quoteName"
  | "quotePhone"
  | "quoteType"
  | "quoteModel"
  | "quoteIssue"
  | "quoteNotes"
  | "quoteReady"
  | "cancelDate"
  | "cancelName"
  | "cancelPhone"
  | "cancelSelect"
  | "cancelRequest"
  | "historyName"
  | "historyPhone"
  | "historyList"
  | "serviceStatusName"
  | "serviceStatusPhone"
  | "serviceStatusResult"
  | "contactList"
  | "voiceSlotSelect";

type FlowMode = "booking" | "availability" | "browse" | "quote";

interface Message {
  role: "assistant" | "user";
  content: string;
}

type SheilaChatProps = {
  companyName?: string;
  welcomeMessage?: string;
  providerWhatsapp?: string | null;
  providerName?: string | null;
  initialOptions?: string[] | null;
};

const menuOptions: ChatOption[] = [
  { id: "agendar", label: "Agendar serviço", icon: Calendar },
  { id: "orcamento", label: "Solicitar orçamento", icon: ClipboardList },
  { id: "consultar_servico", label: "Consultar meu serviço", icon: ClipboardList },
  { id: "servicos", label: "Ver serviços", icon: Wrench },
  { id: "horarios", label: "Horários disponíveis", icon: Clock },
  { id: "registros", label: "Ver registros recentes", icon: ClipboardList },
  { id: "cancelar", label: "Cancelar agendamento", icon: Calendar },
  { id: "ajuda", label: "Falar com atendente", icon: HelpCircle },
];

const MENU_SHORTCUT_STEPS: ChatStep[] = [
  "services",
  "chooseProfessional",
  "selectDate",
  "quoteName",
  "quotePhone",
  "quoteType",
  "quoteModel",
  "quoteIssue",
  "quoteNotes",
  "quoteReady",
  "cancelDate",
  "cancelName",
  "cancelPhone",
  "cancelSelect",
  "cancelRequest",
  "historyName",
  "historyPhone",
  "historyList",
  "serviceStatusName",
  "serviceStatusPhone",
  "serviceStatusResult",
  "contactList",
  "voiceSlotSelect",
];


type Profissional = {
  Id: number;
  Nome: string;
  Whatsapp?: string | null;
  Ativo: boolean;
};

type ProfissionaisResp = {
  ok: boolean;
  profissionais: Profissional[];
};

type CancelAppointment = {
  AgendamentoId: number;
  Servico?: string;
  DataAgendada: string;
  HoraAgendada?: string;
  InicioEm?: string;
  ClienteNome?: string;
  AgendamentoStatus?: string;
};

type CancelLookupResp = {
  ok: boolean;
  date: string;
  total: number;
  agendamentos: CancelAppointment[];
};

type RecentAppointment = {
  AgendamentoId: number;
  AtendimentoId?: number;
  ServicoId?: number;
  Servico?: string;
  DataAgendada: string;
  HoraAgendada?: string;
  InicioEm?: string;
  FimEm?: string;
  ClienteNome?: string;
  ClienteWhatsapp?: string;
  AgendamentoStatus?: string;
};

type RecentLookupResp = {
  ok: boolean;
  total: number;
  agendamentos: RecentAppointment[];
};

type ServiceStatusLookupResp = {
  ok: boolean;
  ordem?: {
    NumeroOS: string;
    AparelhoModelo: string;
    DefeitoResumo: string;
    Status: string;
    StatusAmigavel: string;
    PrevisaoEntrega: string | null;
    ValorTotal: number;
    ProntoParaRetirada: boolean;
  };
  error?: string;
};

type QuoteRequestPayload = {
  nome: string;
  telefone: string;
  tipoItem?: string | null;
  modelo: string;
  defeito: string;
  observacoes?: string | null;
};

type QuoteRequestResponse = {
  ok: boolean;
  solicitacao?: {
    Id: number;
    Status: string;
  };
};

function buildDefaultWelcome(companyName?: string) {
  const nome = companyName?.trim() || "a empresa";
  return (
    `Olá! 👋 Eu sou a Sheila, assistente virtual da ${nome}!\n\n` +
    "Estou aqui para te ajudar com agendamentos, orçamentos e informações sobre nossos serviços. Como posso te ajudar hoje?"
  );
}

function sanitizeWhatsapp(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function buildWhatsappUrl(value?: string | null) {
  const digits = sanitizeWhatsapp(value);
  if (!digits) return "";

  const target =
    digits.startsWith("55") || digits.length > 11
      ? digits
      : `55${digits}`;

  return `https://wa.me/${target}`;
}

export function SheilaChat({ companyName, welcomeMessage, providerWhatsapp, providerName, initialOptions }: SheilaChatProps) {
  const [step, setStep] = useState<ChatStep>("welcome");
  const [flowMode, setFlowMode] = useState<FlowMode>("booking");

  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [bookingSubmitting, setBookingSubmitting] = useState(false);

  const [quoteName, setQuoteName] = useState("");
  const [quotePhone, setQuotePhone] = useState("");
  const [quoteType, setQuoteType] = useState("");
  const [quoteModel, setQuoteModel] = useState("");
  const [quoteIssue, setQuoteIssue] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [cancelDate, setCancelDate] = useState("");
  const [cancelName, setCancelName] = useState("");
  const [cancelPhone, setCancelPhone] = useState("");
  const [cancelMatches, setCancelMatches] = useState<CancelAppointment[]>([]);
  const [cancelSelected, setCancelSelected] = useState<CancelAppointment | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [historyName, setHistoryName] = useState("");
  const [historyPhone, setHistoryPhone] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMatches, setHistoryMatches] = useState<RecentAppointment[]>([]);
  const [serviceStatusName, setServiceStatusName] = useState("");
  const [serviceStatusPhone, setServiceStatusPhone] = useState("");
  const [serviceStatusLoading, setServiceStatusLoading] = useState(false);
  const [serviceStatusResult, setServiceStatusResult] = useState<ServiceStatusLookupResp["ordem"] | null>(null);
  const [professionals, setProfessionals] = useState<Profissional[]>([]);
  const [selectedProfessional, setSelectedProfessional] = useState<Profissional | null>(null);
  const [serviceProfessionals, setServiceProfessionals] = useState<Profissional[]>([]);
  const [voiceSlots, setVoiceSlots] = useState<string[]>([]);
  const [voiceDate, setVoiceDate] = useState<string>("");
  const [voiceNextStep, setVoiceNextStep] = useState<string>("");

  const { getActiveServices } = useServices();
  const { createAppointment } = useAppointments();
  const scrollRef = useRef<HTMLDivElement>(null);
  const empresaSlug = getEmpresaSlug();

  const availableMenuOptions = (() => {
    if (!Array.isArray(initialOptions) || initialOptions.length === 0) return menuOptions;

    // Retrocompatibilidade: empresas que já tinham opções salvas antes do fluxo de cancelamento
    // podem não ter o id "cancelar" persistido, então garantimos exibição do atalho.
    const enabled = new Set(initialOptions);
    enabled.add("cancelar");
    enabled.add("registros");
    enabled.add("consultar_servico");
    return menuOptions.filter((option) => enabled.has(option.id));
  })();

  const services = getActiveServices();
  const whatsappDigits = sanitizeWhatsapp(providerWhatsapp);
  const whatsappTarget =
    whatsappDigits && !whatsappDigits.startsWith("55") && (whatsappDigits.length === 10 || whatsappDigits.length === 11)
      ? `55${whatsappDigits}`
      : whatsappDigits;
  const quotePreview = useMemo(
    () =>
      [
        `Nome: ${quoteName || "-"}`,
        `Telefone: ${quotePhone || "-"}`,
        `Tipo de aparelho/servico: ${quoteType || "-"}`,
        `Modelo: ${quoteModel || "-"}`,
        `Defeito: ${quoteIssue || "-"}`,
        `Observacoes: ${quoteNotes || "-"}`,
      ].join("\n"),
    [quoteName, quotePhone, quoteType, quoteModel, quoteIssue, quoteNotes]
  );
  const visibleContacts = useMemo(() => {
    const contacts = new Map<string, { name: string; phone: string }>();

    const mainPhone = sanitizeWhatsapp(providerWhatsapp);
    if (mainPhone) {
      contacts.set(`owner:${mainPhone}`, {
        name: providerName?.trim() || companyName?.trim() || "Prestador principal",
        phone: providerWhatsapp || mainPhone,
      });
    }

    for (const professional of professionals) {
      const phone = sanitizeWhatsapp(professional.Whatsapp);
      if (!phone || professional.Ativo === false) continue;
      contacts.set(`professional:${professional.Id}:${phone}`, {
        name: professional.Nome || "Profissional",
        phone: professional.Whatsapp || phone,
      });
    }

    return [...contacts.values()];
  }, [companyName, professionals, providerName, providerWhatsapp]);

  const activeProfessionals = useMemo(
    () => professionals.filter((p) => p.Ativo !== false),
    [professionals]
  );
  const requiresProfessionalSelection = activeProfessionals.length > 1;
  const showVoiceEntry = step === "menu";
  const showMenuShortcut = MENU_SHORTCUT_STEPS.includes(step);

  useEffect(() => {
    let alive = true;

    async function loadProfessionals() {
      try {
        const resp = await apiGet<ProfissionaisResp>(
          `/api/empresas/${encodeURIComponent(empresaSlug)}/profissionais?ativos=1`
        );
        if (!alive) return;
        setProfessionals(Array.isArray(resp.profissionais) ? resp.profissionais : []);
      } catch {
        if (!alive) return;
        setProfessionals([]);
      }
    }

    loadProfessionals();
    return () => {
      alive = false;
    };
  }, [empresaSlug]);

  useEffect(() => {
    const msg = (welcomeMessage && welcomeMessage.trim()) || buildDefaultWelcome(companyName);

    const timer = setTimeout(() => {
      setMessages([{ role: "assistant", content: msg }]);
      setStep("menu");

      setFlowMode("booking");
      setSelectedService(null);
      setSelectedDate("");
      setSelectedTime("");
      setClientName("");
      setClientPhone("");
      setQuoteName("");
      setQuotePhone("");
      setQuoteType("");
      setQuoteModel("");
      setQuoteIssue("");
      setQuoteNotes("");
      setQuoteSubmitting(false);
      setCancelDate("");
      setCancelName("");
      setCancelPhone("");
      setCancelMatches([]);
      setCancelSelected(null);
      setCancelLoading(false);
      setHistoryName("");
      setHistoryPhone("");
      setHistoryMatches([]);
      setHistoryLoading(false);
      setSelectedProfessional(null);
      setServiceProfessionals([]);
    }, 300);

    return () => clearTimeout(timer);
  }, [companyName, welcomeMessage]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, step]);

  const addMessage = (role: "assistant" | "user", content: string) => {
    setMessages((prev) => [...prev, { role, content }]);
  };

  const handleVoiceProcessed = ({
    transcript,
    response,
  }: {
    transcript: string;
    response: VoiceInterpretResponse;
  }) => {
    addMessage("user", transcript);
    addMessage("assistant", response.message || response.error || "Nao consegui processar sua mensagem.");

    setVoiceSlots(Array.isArray(response.slots) ? response.slots : []);
    setVoiceDate(response.date || "");
    setVoiceNextStep(response.nextStep || "");

    const detectedServices = Array.isArray(response.servicesDetected) ? response.servicesDetected : [];
    const matchedService =
      detectedServices.length === 1
        ? services.find((service) => Number(service.id) === Number(detectedServices[0].id)) || null
        : null;

    if (matchedService) {
      setSelectedService(matchedService);
    }

    if (response.date) {
      setSelectedDate(response.date);
    }

    if (response.nextStep === "go_cancel_with_date") {
      if (response.date) {
        setCancelDate(response.date);
      }
      setCancelName("");
      setCancelPhone("");
      setCancelMatches([]);
      setCancelSelected(null);
      setStep(response.date ? "cancelName" : "cancelDate");
      return;
    }

    if (response.nextStep === "go_cancel") {
      setCancelDate("");
      setCancelName("");
      setCancelPhone("");
      setCancelMatches([]);
      setCancelSelected(null);
      setStep("cancelDate");
      return;
    }

    if (response.nextStep === "go_history") {
      setHistoryName("");
      setHistoryPhone("");
      setHistoryMatches([]);
      setStep("historyName");
      return;
    }

    if (response.nextStep === "go_contact") {
      setStep(visibleContacts.length ? "contactList" : "menu");
      return;
    }

    if (response.nextStep === "go_quote") {
      setFlowMode("quote");
      setQuoteName("");
      setQuotePhone("");
      setQuoteType("");
      setQuoteModel("");
      setQuoteIssue("");
      setQuoteNotes("");
      setStep("quoteName");
      return;
    }

    if (response.nextStep === "go_services") {
      setFlowMode("browse");
      setStep("services");
      return;
    }

    if (response.nextStep === "ask_service") {
      setStep("services");
      return;
    }

    if (response.nextStep === "ask_date" && matchedService) {
      setFlowMode(response.intent === "agendar_servico" ? "booking" : "availability");
      setStep("selectDate");
      return;
    }

    if (Array.isArray(response.slots) && response.slots.length > 0) {
      if (response.nextStep === "offer_booking") {
        addMessage("assistant", "Se quiser, posso seguir com o agendamento. Escolha um horario abaixo.");
      }
      setStep("voiceSlotSelect");
    }
  };

  const handleVoiceSlotSelect = (time: string) => {
    if (!voiceDate) return;

    setSelectedDate(voiceDate);
    setSelectedTime(time);
    addMessage("user", `Horario: ${time}`);

    if (!selectedService) {
      addMessage("assistant", "Perfeito. Ja encontrei horarios, mas ainda preciso confirmar o servico. Escolha uma opcao abaixo.");
      setStep("services");
      return;
    }

    setFlowMode("booking");
    setStep("clientInfo");
    addMessage("assistant", "Perfeito! Agora preciso de algumas informacoes suas para continuar o agendamento.");
  };

  const handleMenuSelect = (option: ChatOption) => {
    addMessage("user", option.label);

    setTimeout(async () => {
      switch (option.id) {
        case "agendar": {
          setFlowMode("booking");
          setSelectedProfessional(null);
          setServiceProfessionals([]);
          addMessage("assistant", "Ótimo! Aqui estão nossos serviços disponíveis. Escolha um para agendar: 🔧");
          setStep("services");
          break;
        }

        case "orcamento": {
          setFlowMode("quote");
          setQuoteName("");
          setQuotePhone("");
          setQuoteType("");
          setQuoteModel("");
          setQuoteIssue("");
          setQuoteNotes("");
          addMessage(
            "assistant",
            "Perfeito! Vou registrar sua solicitação de orçamento. Primeiro, me diga seu nome."
          );
          setStep("quoteName");
          break;
        }

        case "servicos": {
          setFlowMode("browse");
          addMessage(
            "assistant",
            "Claro! Aqui estão nossos serviços disponíveis. Clique em um serviço para ver mais detalhes: 🔧"
          );
          setStep("services");
          break;
        }

        case "horarios": {
          setFlowMode("availability");
          setSelectedProfessional(null);
          setServiceProfessionals([]);
          addMessage(
            "assistant",
            "Perfeito! Para ver horários disponíveis, primeiro escolha o serviço que você deseja: ⏰"
          );
          setStep("services");
          break;
        }

        case "ajuda": {
          addMessage(
            "assistant",
            visibleContacts.length
              ? `Sem problemas! Você pode entrar em contato diretamente pelo WhatsApp: ${providerWhatsapp}\n\nOu se preferir, posso continuar te atendendo por aqui! 😊`
              : "Sem problemas! Posso continuar te atendendo por aqui. Se quiser, peça um orçamento e eu registro sua solicitação para o painel da equipe. 😊"
          );
          setTimeout(() => setStep(visibleContacts.length ? "contactList" : "menu"), 100);
          break;
        }

        case "cancelar": {
          setCancelDate("");
          setCancelName("");
          setCancelPhone("");
          setCancelMatches([]);
          setCancelSelected(null);
          addMessage(
            "assistant",
            "Sem problemas! Vamos cancelar seu agendamento. Primeiro, me informe a data do agendamento no formato DD/MM/AAAA (ou DD/MM)."
          );
          setStep("cancelDate");
          break;
        }

        case "registros": {
          setHistoryName("");
          setHistoryPhone("");
          setHistoryMatches([]);
          addMessage(
            "assistant",
            "Claro! Posso te mostrar seus registros recentes. Primeiro, me informe o nome usado no agendamento."
          );
          setStep("historyName");
          break;
        }

        case "consultar_servico": {
          setServiceStatusName("");
          setServiceStatusPhone("");
          setServiceStatusResult(null);
          addMessage(
            "assistant",
            "Perfeito! Vamos consultar o status do seu servico. Primeiro, me informe seu nome."
          );
          setStep("serviceStatusName");
          break;
        }
      }
    }, 300);
  };

  const parseCancelDateToIso = (value: string) => {
    const raw = value.trim();
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!match) return "";

    const day = Number(match[1]);
    const month = Number(match[2]);
    const now = new Date();
    const rawYear = match[3];
    const year = rawYear ? (rawYear.length === 2 ? Number(`20${rawYear}`) : Number(rawYear)) : now.getFullYear();
    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return "";

    const dt = new Date(year, month - 1, day);
    if (dt.getDate() !== day || dt.getMonth() !== month - 1 || dt.getFullYear() !== year) return "";

    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const formatTime = (horaAgendada?: string, inicioEm?: string) => {
    const raw = String(horaAgendada || inicioEm || "").trim();
    if (!raw) return "--:--";
    if (/^\d{2}:\d{2}$/.test(raw)) return raw;
    const match = raw.match(/T(\d{2}:\d{2})/) || raw.match(/\s(\d{2}:\d{2})/);
    return match?.[1] || raw.slice(0, 5) || "--:--";
  };

  const handleSubmitCancelDate = () => {
    const iso = parseCancelDateToIso(cancelDate);
    if (!iso) {
      addMessage("assistant", "Por favor, informe uma data válida no formato DD/MM/AAAA.");
      return;
    }

    setCancelDate(iso);
    addMessage("user", `Data do agendamento: ${iso}`);
    addMessage("assistant", "Agora me informe o nome usado no agendamento.");
    setStep("cancelName");
  };

  const handleSubmitCancelName = () => {
    const name = cancelName.trim();
    if (!name) {
      addMessage("assistant", "Por favor, informe seu nome.");
      return;
    }

    setCancelName(name);
    addMessage("user", `Nome: ${name}`);
    addMessage("assistant", "Perfeito! Agora me informe o telefone usado no agendamento (com DDD). Ex: 11999999999");
    setStep("cancelPhone");
  };

  const handleSubmitCancelPhone = async () => {
    const phoneDigits = cancelPhone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      addMessage("assistant", "Informe um telefone válido para continuar.");
      return;
    }

    setCancelLoading(true);
    addMessage("user", `Telefone: ${phoneDigits}`);

    try {
      const resp = await apiPost<CancelLookupResp>(
        `/api/empresas/${encodeURIComponent(empresaSlug)}/agendamentos/cancelamento/buscar`,
        { date: cancelDate, phone: phoneDigits, name: cancelName }
      );

      const list = Array.isArray(resp.agendamentos) ? resp.agendamentos : [];
      setCancelMatches(list);
      setCancelSelected(null);

      if (!list.length) {
        addMessage(
          "assistant",
          "Não encontrei agendamento pendente/confirmado com esses dados. Confira nome, data e telefone e tente novamente."
        );
        setStep("menu");
        return;
      }

      addMessage("assistant", "Encontrei estes agendamentos. Qual você deseja cancelar?");
      setStep("cancelSelect");
    } catch {
      addMessage("assistant", "Não consegui consultar seus agendamentos agora. Tente novamente em instantes.");
      setStep("menu");
    } finally {
      setCancelLoading(false);
    }
  };

  const getStatusPresentation = (status?: string) => {
    const normalized = String(status || "").trim().toLowerCase();

    switch (normalized) {
      case "confirmed":
        return {
          label: "Confirmado",
          icon: BadgeCheck,
          className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        };
      case "pending":
        return {
          label: "Pendente",
          icon: CircleDashed,
          className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
        };
      case "cancelled":
        return {
          label: "Cancelado",
          icon: XCircle,
          className: "border-red-500/30 bg-red-500/10 text-red-300",
        };
      case "completed":
        return {
          label: "Realizado",
          icon: CheckCircle2,
          className: "border-blue-500/30 bg-blue-500/10 text-blue-300",
        };
      default:
        return {
          label: "Sem status",
          icon: CircleDashed,
          className: "border-border/60 bg-secondary/40 text-muted-foreground",
        };
    }
  };

  const handleSubmitHistoryName = () => {
    const name = historyName.trim();
    if (!name) {
      addMessage("assistant", "Por favor, informe seu nome.");
      return;
    }

    setHistoryName(name);
    addMessage("user", `Nome: ${name}`);
    addMessage("assistant", "Agora me informe o celular usado no agendamento, com DDD.");
    setStep("historyPhone");
  };

  const handleSubmitHistoryPhone = async () => {
    const phoneDigits = historyPhone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      addMessage("assistant", "Informe um telefone válido para continuar.");
      return;
    }

    setHistoryLoading(true);
    addMessage("user", `Celular: ${phoneDigits}`);

    try {
      const resp = await apiPost<RecentLookupResp>(
        `/api/empresas/${encodeURIComponent(empresaSlug)}/agendamentos/consultar-recentes`,
        { phone: phoneDigits, name: historyName }
      );

      const list = Array.isArray(resp.agendamentos) ? resp.agendamentos : [];
      setHistoryMatches(list);

      if (!list.length) {
        addMessage(
          "assistant",
          "Nao encontrei registros recentes com esses dados. Confira nome e celular e tente novamente."
        );
        setStep("menu");
        return;
      }

      addMessage("assistant", "Encontrei estes registros recentes do seu agendamento:");
      setStep("historyList");
    } catch {
      addMessage("assistant", "Nao consegui consultar seus registros agora. Tente novamente em instantes.");
      setStep("menu");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSubmitServiceStatusName = () => {
    const name = serviceStatusName.trim();
    if (!name) {
      addMessage("assistant", "Por favor, informe seu nome.");
      return;
    }

    setServiceStatusName(name);
    addMessage("user", `Nome: ${name}`);
    addMessage("assistant", "Agora me informe o celular usado na ordem de servico, com DDD.");
    setStep("serviceStatusPhone");
  };

  const formatCurrencyBRL = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

  const formatCivilDateBR = (value?: string | null) => {
    const raw = String(value || "").trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return raw;
    return `${match[3]}/${match[2]}/${match[1]}`;
  };

  const handleSubmitServiceStatusPhone = async () => {
    const phoneDigits = serviceStatusPhone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      addMessage("assistant", "Informe um telefone válido para continuar.");
      return;
    }

    setServiceStatusLoading(true);
    addMessage("user", `Celular: ${phoneDigits}`);

    try {
      const resp = await apiPost<ServiceStatusLookupResp>(
        `/api/empresas/${encodeURIComponent(empresaSlug)}/ordens-servico/consultar-status`,
        { phone: phoneDigits, name: serviceStatusName }
      );

      if (!resp?.ordem) {
        addMessage("assistant", "Nao localizamos servico com esses dados. Confira nome e celular e tente novamente.");
        setStep("menu");
        return;
      }

      setServiceStatusResult(resp.ordem);

      if (resp.ordem.ProntoParaRetirada) {
        addMessage(
          "assistant",
          `Seu aparelho esta pronto para retirada ✅\nOS: ${resp.ordem.NumeroOS}\nAparelho: ${resp.ordem.AparelhoModelo}`
        );
      } else {
        const preview = [
          `Ordem de Servico: ${resp.ordem.NumeroOS}`,
          `Aparelho: ${resp.ordem.AparelhoModelo}`,
          `Problema: ${resp.ordem.DefeitoResumo || "-"}`,
          `Status: ${resp.ordem.StatusAmigavel}`,
          resp.ordem.PrevisaoEntrega ? `Previsao de entrega: ${formatCivilDateBR(resp.ordem.PrevisaoEntrega)}` : null,
          `Valor total: ${formatCurrencyBRL(resp.ordem.ValorTotal)}`,
        ]
          .filter(Boolean)
          .join("\n");

        addMessage("assistant", preview);
      }

      setStep("serviceStatusResult");
    } catch {
      addMessage("assistant", "Nao consegui consultar seu servico agora. Tente novamente em instantes.");
      setStep("menu");
    } finally {
      setServiceStatusLoading(false);
    }
  };

  const handleSelectCancelAppointment = async (appointmentId: number) => {
    if (!appointmentId) return;

    const chosen = cancelMatches.find((item) => Number(item.AgendamentoId) === Number(appointmentId));
    if (!chosen) return;

    setCancelSelected(chosen);
    addMessage("user", `Cancelar: ${formatTime(chosen.HoraAgendada, chosen.InicioEm)} - ${chosen.Servico || "Serviço"}`);
    addMessage(
      "assistant",
      "Perfeito! Para segurança, vou gerar uma mensagem para o WhatsApp do prestador. O cancelamento será confirmado pelo admin no painel."
    );
    setStep("cancelRequest");
  };

  const cancelWhatsappUrl = (() => {
    if (!cancelSelected || !whatsappTarget) return "";

    const empresa = companyName?.trim() || "estabelecimento";
    const service = cancelSelected.Servico || "Serviço";
    const oldTime = formatTime(cancelSelected.HoraAgendada, cancelSelected.InicioEm);
    const client = cancelSelected.ClienteNome || "Cliente";
    const phone = cancelPhone.replace(/\D/g, "");

    const text =
      `Olá, equipe ${empresa}! Tudo bem?\n\n` +
      `Solicito cancelamento do meu agendamento:\n` +
      `• Código: #${cancelSelected.AgendamentoId}\n` +
      `• Cliente: ${client}\n` +
      `• Telefone: ${phone}\n` +
      `• Serviço: ${service}\n` +
      `• Data/Hora atual: ${cancelSelected.DataAgendada} às ${oldTime}\n\n` +
      `Peço confirmação do cancelamento no painel do admin. Obrigado!`;

    return `https://wa.me/${whatsappTarget}?text=${encodeURIComponent(text)}`;
  })();

  const handleSubmitQuoteName = () => {
    const value = quoteName.trim();
    if (!value) return;
    setQuoteName(value);
    addMessage("user", `Nome: ${value}`);
    addMessage("assistant", "Agora me informe seu número de celular com DDD.");
    setStep("quotePhone");
  };

  const handleSubmitQuotePhone = () => {
    const digits = quotePhone.replace(/\D/g, "");
    if (digits.length < 10) return;
    setQuotePhone(digits);
    addMessage("user", `Celular: ${digits}`);
    addMessage("assistant", "Perfeito! Qual o tipo de aparelho ou serviço?");
    setStep("quoteType");
  };

  const handleSubmitQuoteType = () => {
    const value = quoteType.trim();
    if (!value) return;
    setQuoteType(value);
    addMessage("user", `Tipo: ${value}`);
    addMessage("assistant", "Agora me diga o modelo.");
    setStep("quoteModel");
  };

  const handleSubmitQuoteModel = () => {
    const value = quoteModel.trim();
    if (!value) return;
    setQuoteModel(value);
    addMessage("user", `Modelo: ${value}`);
    addMessage("assistant", "Agora descreva o defeito/problema.");
    setStep("quoteIssue");
  };

  const handleSubmitQuoteIssue = () => {
    const value = quoteIssue.trim();
    if (!value) return;
    setQuoteIssue(value);
    addMessage("user", `Defeito: ${value}`);
    addMessage("assistant", "Se quiser, adicione observações extras. Esse campo é opcional.");
    setStep("quoteNotes");
  };

  const handleSubmitQuoteNotes = (skip = false) => {
    const value = skip ? "" : quoteNotes.trim();
    setQuoteNotes(value);
    if (!skip && value) {
      addMessage("user", `Observações: ${value}`);
    }
    addMessage("assistant", "Ótimo! Revise os dados e envie sua solicitação de orçamento.");
    setStep("quoteReady");
  };

  const handleSubmitQuoteRequest = async () => {
    const payload: QuoteRequestPayload = {
      nome: quoteName.trim(),
      telefone: quotePhone.replace(/\D/g, ""),
      tipoItem: quoteType.trim() || null,
      modelo: quoteModel.trim(),
      defeito: quoteIssue.trim(),
      observacoes: quoteNotes.trim() || null,
    };

    if (!payload.nome || payload.telefone.length < 10 || !payload.modelo || !payload.defeito) {
      addMessage("assistant", "Faltam dados obrigatórios para enviar sua solicitação. Confira nome, celular, modelo e defeito.");
      return;
    }

    try {
      setQuoteSubmitting(true);
      await apiPost<QuoteRequestResponse>(
        `/api/empresas/${encodeURIComponent(empresaSlug)}/orcamentos/solicitacoes`,
        payload
      );
      addMessage("assistant", "Recebemos sua solicitação de orçamento. Nossa equipe irá analisar e entrar em contato.");
      setStep("menu");
    } catch (err: any) {
      addMessage("assistant", err?.message || "Não foi possível registrar sua solicitação agora. Tente novamente em instantes.");
    } finally {
      setQuoteSubmitting(false);
    }
  };

  const handleServiceSelect = async (service: Service) => {
    setSelectedService(service);
    addMessage("user", `${service.name}`);

    setTimeout(async () => {
      if (flowMode === "browse") {
        addMessage(
          "assistant",
          `✅ Serviço: "${service.name}"\n⏱️ Duração: ${service.duration} minutos\n\nSe quiser agendar, selecione "Agendar serviço" no menu.`
        );
        setSelectedService(null);
        setStep("menu");
        return;
      }

      const intro =
        flowMode === "availability"
          ? `Show! O serviço "${service.name}" tem duração de ${service.duration} minutos.\n\nAgora escolha uma data para ver os horários disponíveis: 📅`
          : `Excelente escolha! O serviço "${service.name}" tem duração de ${service.duration} minutos.\n\nAgora escolha uma data e horário disponível: 📅`;

      addMessage("assistant", intro);
      if (requiresProfessionalSelection) {
        try {
          const resp = await apiGet<ProfissionaisResp>(`/api/empresas/${encodeURIComponent(empresaSlug)}/profissionais?ativos=1&servicoId=${encodeURIComponent(String(service.id))}`);
          const compatible = Array.isArray(resp.profissionais) ? resp.profissionais : [];
          if (!compatible.length) {
            addMessage("assistant", "Nenhum profissional ativo está configurado para esse serviço. Escolha outro serviço.");
            setStep("services");
            return;
          }
          setServiceProfessionals(compatible);
        } catch {
          setServiceProfessionals(activeProfessionals);
        }
        addMessage("assistant", "Antes de continuar, escolha o profissional do atendimento:");
        setStep("chooseProfessional");
      } else {
        setServiceProfessionals([]);
        setSelectedProfessional(activeProfessionals[0] || null);
        setStep("selectDate");
      }
    }, 300);
  };

  const handleDateTimeSelect = (date: string, time: string) => {
    setSelectedDate(date);
    setSelectedTime(time);

    addMessage("user", `Data: ${date}, Horário: ${time}`);

    if (flowMode === "availability") {
      setStep("menu");
      setTimeout(() => {
        addMessage(
          "assistant",
          "✅ Esse horário está selecionado.\n\nSe você quiser confirmar um agendamento, clique em 'Agendar serviço' no menu e escolha o serviço novamente (na próxima etapa vamos deixar isso direto)."
        );

        setSelectedService(null);
        setSelectedDate("");
        setSelectedTime("");
      }, 200);

      return;
    }

    setStep("clientInfo");

    setTimeout(() => {
      addMessage(
        "assistant",
        "Perfeito! Agora preciso de algumas informações suas para finalizar o agendamento: ✍️"
      );
    }, 200);
  };

  const handleClientSubmit = async (name: string, phone: string, notes: string) => {
  if (bookingSubmitting) return;

  setClientName(name);
  setClientPhone(phone);

  if (!selectedService) {
    addMessage("assistant", "Ops! Não consegui identificar o serviço. Vamos escolher o serviço novamente.");
    setStep("services");
    return;
  }

  try {
    setBookingSubmitting(true);

    const serviceId = Number(selectedService.id);
    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      addMessage("assistant", "Não consegui identificar o serviço selecionado. Vamos tentar novamente.");
      setStep("services");
      return;
    }

    await createAppointment({
      clientName: name,
      clientPhone: phone,
      serviceId,
      date: selectedDate,
      time: selectedTime,
      notes: notes || undefined,
      profissionalId: selectedProfessional?.Id ?? null,
    });

    addMessage("user", `Nome: ${name}, Telefone: ${phone}`);

    setTimeout(() => {
      addMessage(
        "assistant",
        "Seu agendamento foi enviado com sucesso. O prestador ja foi notificado, agora e so aguardar a confirmacao."
      );
      setStep("confirmation");
    }, 300);
  } catch (err: any) {
    const message = String(err?.message || "").toLowerCase();
    if (
      message.includes("não está mais disponível") ||
      message.includes("nao está mais disponível") ||
      message.includes("nao esta mais disponivel")
    ) {
      addMessage(
        "assistant",
        "Esse horario acabou de ser reservado por outra pessoa. Vamos escolher outro horario."
      );
    } else {
      addMessage(
        "assistant",
        "Nao consegui concluir seu agendamento agora. Se o erro persistir, tente novamente em instantes."
      );
    }
    setStep("clientInfo");
  } finally {
    setBookingSubmitting(false);
  }
};

  const handleBackToMenu = () => {
    setFlowMode("booking");
    setSelectedService(null);
    setSelectedDate("");
    setSelectedTime("");
    setClientName("");
    setClientPhone("");
    setQuoteName("");
    setQuotePhone("");
    setQuoteType("");
    setQuoteModel("");
    setQuoteIssue("");
    setQuoteNotes("");
    setQuoteSubmitting(false);
    setCancelDate("");
    setCancelName("");
    setCancelPhone("");
    setCancelMatches([]);
    setCancelSelected(null);
    setCancelLoading(false);
    setHistoryName("");
    setHistoryPhone("");
    setHistoryMatches([]);
    setHistoryLoading(false);
    setServiceStatusName("");
    setServiceStatusPhone("");
    setServiceStatusResult(null);
    setServiceStatusLoading(false);
    setSelectedProfessional(null);
    setServiceProfessionals([]);
    addMessage("assistant", "Como posso te ajudar agora?");
    setStep("menu");
  };

  const handleRescheduleFromCancel = () => {
    setCancelDate("");
    setCancelPhone("");
    setCancelMatches([]);
    setFlowMode("booking");
    addMessage("assistant", "Perfeito! Vamos remarcar. Escolha um serviço para começar. 🔧");
    setStep("services");
  };

  return (
    <div className="flex flex-col h-full w-full min-w-0 overflow-x-hidden">
      <div className="flex items-center gap-4 p-4 border-b border-border bg-card/50 backdrop-blur-sm">
        <SheilaAvatar />
        <div>
          <h2 className="font-display font-bold text-lg text-foreground">Sheila</h2>
          <p className="text-sm text-muted-foreground">Assistente Virtual</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs text-muted-foreground">Online</span>
        </div>
      </div>

      <ScrollArea className="flex-1 p-2 sm:p-4" ref={scrollRef}>
        <div className="space-y-4 pb-4">
          {messages.map((msg, idx) => (
            <ChatMessage key={idx} role={msg.role} content={msg.content} />
          ))}

          {showVoiceEntry && (
            <div className="pl-0 sm:pl-11">
              <VoiceButton onVoiceProcessed={handleVoiceProcessed} />
            </div>
          )}

          {step === "menu" && (
            <div className="pl-0 sm:pl-11">
              <ChatOptions options={availableMenuOptions} onSelect={handleMenuSelect} />
            </div>
          )}

          {step === "services" && (
            <div className="pl-0 sm:pl-11 space-y-3 min-w-0">
              {services.map((service) => (
                <ServiceCard key={service.id} service={service} onSelect={handleServiceSelect} />
              ))}
            </div>
          )}

          {step === "voiceSlotSelect" && voiceSlots.length > 0 && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">
                {voiceNextStep === "offer_booking"
                  ? "Escolha um horario se quiser continuar com o agendamento:"
                  : "Escolha um horario para continuar:"}
              </p>
              <div className="flex flex-wrap gap-2">
                {voiceSlots.map((slot) => (
                  <Button
                    key={slot}
                    variant="outline"
                    onClick={() => handleVoiceSlotSelect(slot)}
                  >
                    {slot}
                  </Button>
                ))}
              </div>
            </div>
          )}


          {step === "chooseProfessional" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3" data-cy="choose-professional">
              <p className="text-sm text-muted-foreground">Escolha com qual profissional você deseja agendar:</p>
              <div className="space-y-2">
                {(serviceProfessionals.length ? serviceProfessionals : activeProfessionals).map((professional) => (
                  <Button
                    key={professional.Id}
                    variant={selectedProfessional?.Id === professional.Id ? "default" : "outline"}
                    className="w-full justify-start"
                    onClick={() => {
                      setSelectedProfessional(professional);
                      addMessage("user", `Profissional: ${professional.Nome}`);
                      setStep("selectDate");
                    }}
                  >
                    {professional.Nome}
                  </Button>
                ))}
              </div>
              <Button variant="ghost" onClick={() => setStep("services")}>Voltar</Button>
            </div>
          )}

          {step === "selectDate" && selectedService && (
            <div className="pl-0 sm:pl-11">
              <DateTimePicker
                onSelect={handleDateTimeSelect}
                onBack={() => setStep("services")}
                serviceDuration={selectedService.duration}
                serviceId={selectedService.id}
                profissionalId={selectedProfessional?.Id ?? null}
              />
            </div>
          )}

          {step === "clientInfo" && (
            <div className="pl-0 sm:pl-11">
              <ClientForm
                onSubmit={handleClientSubmit}
                onBack={() => setStep("selectDate")}
                isSubmitting={bookingSubmitting}
              />
            </div>
          )}

          {step === "confirmation" && selectedService && (
            <div className="pl-0 sm:pl-11">
              <BookingConfirmation
                service={selectedService}
                date={selectedDate}
                time={selectedTime}
                clientName={clientName}
                clientPhone={clientPhone}
                onNewBooking={handleBackToMenu}
              />
            </div>
          )}

          {step === "quoteName" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Informe seu nome completo.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={quoteName}
                  onChange={(e) => setQuoteName(e.target.value)}
                  placeholder="Seu nome"
                  data-cy="quote-name-input"
                />
                <Button className="w-full sm:w-auto" onClick={handleSubmitQuoteName} data-cy="quote-name-next">
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "quotePhone" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Informe seu celular com DDD.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={quotePhone}
                  onChange={(e) => setQuotePhone(e.target.value)}
                  placeholder="Ex.: 11999999999"
                  data-cy="quote-phone-input"
                />
                <Button className="w-full sm:w-auto" onClick={handleSubmitQuotePhone} data-cy="quote-phone-next">
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "quoteType" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Qual o tipo de aparelho ou serviço?</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={quoteType}
                  onChange={(e) => setQuoteType(e.target.value)}
                  placeholder="Ex.: celular, tablet, troca de tela..."
                  data-cy="quote-type-input"
                />
                <Button className="w-full sm:w-auto" onClick={handleSubmitQuoteType} data-cy="quote-type-next">
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "quoteModel" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Informe o modelo do item para orçamento.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={quoteModel}
                  onChange={(e) => setQuoteModel(e.target.value)}
                  placeholder="Digite o modelo do item"
                  data-cy="quote-model-input"
                />
                <Button className="w-full sm:w-auto" onClick={handleSubmitQuoteModel} data-cy="quote-model-next">
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "quoteIssue" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Descreva o problema apresentado no item.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={quoteIssue}
                  onChange={(e) => setQuoteIssue(e.target.value)}
                  placeholder="Descreva o problema para análise"
                  data-cy="quote-issue-input"
                />
                <Button className="w-full sm:w-auto" onClick={handleSubmitQuoteIssue} data-cy="quote-issue-next">
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "quoteNotes" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Observações opcionais.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                  placeholder="Ex.: aparelho já abriu antes, urgência, etc."
                  data-cy="quote-notes-input"
                />
                <Button className="w-full sm:w-auto" onClick={() => handleSubmitQuoteNotes(false)} data-cy="quote-notes-next">
                  Continuar
                </Button>
              </div>
              <Button variant="ghost" className="w-full" onClick={() => handleSubmitQuoteNotes(true)} data-cy="quote-notes-skip">
                Pular observações
              </Button>
            </div>
          )}

          {step === "quoteReady" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3" data-cy="quote-ready">
              <p className="text-sm text-muted-foreground">Revise os dados da sua solicitação:</p>
              <div className="rounded-md bg-secondary/40 p-3 text-sm whitespace-pre-wrap">
                {quotePreview}
              </div>

              <Button className="w-full" onClick={handleSubmitQuoteRequest} disabled={quoteSubmitting} data-cy="quote-submit-request">
                {quoteSubmitting ? "Enviando..." : "Enviar solicitação de orçamento"}
              </Button>

              <Button variant="outline" className="w-full" onClick={handleBackToMenu} data-cy="quote-new-request">
                Voltar ao menu
              </Button>
            </div>
          )}

          {step === "serviceStatusName" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Digite o nome usado na ordem de serviço.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={serviceStatusName}
                  onChange={(e) => setServiceStatusName(e.target.value)}
                  placeholder="Nome conforme cadastro da OS"
                  data-cy="service-status-name-input"
                />
                <Button className="w-full sm:w-auto" onClick={handleSubmitServiceStatusName} data-cy="service-status-name-next">
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "serviceStatusPhone" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Digite o celular usado na OS, com DDD.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={serviceStatusPhone}
                  onChange={(e) => setServiceStatusPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="Ex.: 11999999999"
                  data-cy="service-status-phone-input"
                />
                <Button
                  className="w-full sm:w-auto"
                  onClick={handleSubmitServiceStatusPhone}
                  disabled={serviceStatusLoading}
                  data-cy="service-status-phone-next"
                >
                  {serviceStatusLoading ? "Consultando..." : "Consultar serviço"}
                </Button>
              </div>
            </div>
          )}

          {step === "serviceStatusResult" && serviceStatusResult && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3" data-cy="service-status-result">
              <p className="text-sm text-muted-foreground">Resumo do seu serviço:</p>
              <div className="rounded-md bg-secondary/40 p-3 text-sm whitespace-pre-wrap">
                {[
                  `OS: ${serviceStatusResult.NumeroOS}`,
                  `Aparelho: ${serviceStatusResult.AparelhoModelo || "-"}`,
                  `Problema: ${serviceStatusResult.DefeitoResumo || "-"}`,
                  `Status: ${serviceStatusResult.StatusAmigavel || "-"}`,
                  serviceStatusResult.PrevisaoEntrega ? `Previsão: ${formatCivilDateBR(serviceStatusResult.PrevisaoEntrega)}` : null,
                ]
                  .filter(Boolean)
                  .join("\n")}
              </div>
              {serviceStatusResult.ProntoParaRetirada && (
                <p className="text-sm text-emerald-300">Seu aparelho já pode ser retirado ✅</p>
              )}
              <Button variant="outline" className="w-full" onClick={handleBackToMenu} data-cy="service-status-back-menu">
                Voltar ao menu
              </Button>
            </div>
          )}

          {step === "cancelDate" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Informe a data do agendamento (DD/MM/AAAA ou DD/MM).</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={cancelDate}
                  onChange={(e) => setCancelDate(e.target.value)}
                  placeholder="Ex.: 19/03/2026"
                  data-cy="cancel-date-input"
                />
                <Button className="w-full sm:w-auto" onClick={handleSubmitCancelDate} data-cy="cancel-date-next">
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "historyName" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Digite o nome usado no agendamento.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={historyName}
                  onChange={(e) => setHistoryName(e.target.value)}
                  placeholder="Nome conforme agendamento"
                  data-cy="history-name-input"
                />
                <Button className="w-full sm:w-auto" onClick={handleSubmitHistoryName} data-cy="history-name-next">
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "historyPhone" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Digite o celular usado no agendamento, com DDD.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={historyPhone}
                  onChange={(e) => setHistoryPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="Ex.: 11999999999"
                  data-cy="history-phone-input"
                />
                <Button
                  className="w-full sm:w-auto"
                  onClick={handleSubmitHistoryPhone}
                  disabled={historyLoading}
                  data-cy="history-phone-next"
                >
                  {historyLoading ? "Buscando..." : "Buscar registros"}
                </Button>
              </div>
            </div>
          )}

          {step === "historyList" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3" data-cy="history-list">
              <p className="text-sm text-muted-foreground">Estes sao seus registros recentes:</p>
              <div className="space-y-3">
                {historyMatches.map((apt) => {
                  const statusUi = getStatusPresentation(apt.AgendamentoStatus);
                  const StatusIcon = statusUi.icon;

                  return (
                    <div
                      key={apt.AgendamentoId}
                      className="rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground break-words">{apt.Servico || "Servico"}</p>
                          <p className="text-sm text-muted-foreground">
                            {apt.DataAgendada} as {formatTime(apt.HoraAgendada, apt.InicioEm)}
                          </p>
                        </div>
                        <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${statusUi.className}`}>
                          <StatusIcon size={14} />
                          {statusUi.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Button variant="outline" className="w-full" onClick={handleBackToMenu} data-cy="history-back-menu">
                Voltar ao menu
              </Button>
            </div>
          )}

          {step === "contactList" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3" data-cy="contact-list">
              <p className="text-sm text-muted-foreground">Escolha um contato para falar diretamente no WhatsApp.</p>
              <div className="space-y-3">
                {visibleContacts.map((contact, index) => {
                  const url = buildWhatsappUrl(contact.phone);
                  return (
                    <div key={`${contact.name}-${contact.phone}-${index}`} className="rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-2">
                      <div>
                        <p className="font-medium text-foreground break-words">{contact.name}</p>
                        <p className="text-sm text-muted-foreground break-all">{contact.phone}</p>
                      </div>
                      {url ? (
                        <Button asChild className="w-full">
                          <a href={url} target="_blank" rel="noreferrer">
                            <Send size={16} className="mr-2" />
                            Abrir WhatsApp
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <Button variant="outline" className="w-full" onClick={handleBackToMenu} data-cy="contact-back-menu">
                Voltar ao menu
              </Button>
            </div>
          )}

          {step === "cancelPhone" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Digite o telefone usado no agendamento (com DDD).</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={cancelPhone}
                  onChange={(e) => setCancelPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="Ex.: 11999999999"
                  data-cy="cancel-phone-input"
                />
                <Button
                  className="w-full sm:w-auto"
                  onClick={handleSubmitCancelPhone}
                  disabled={cancelLoading}
                  data-cy="cancel-phone-next"
                >
                  {cancelLoading ? "Buscando..." : "Buscar agendamento"}
                </Button>
              </div>
            </div>
          )}

          {step === "cancelName" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm text-muted-foreground">Digite o nome usado no agendamento.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={cancelName}
                  onChange={(e) => setCancelName(e.target.value)}
                  placeholder="Nome conforme agendamento"
                  data-cy="cancel-name-input"
                />
                <Button className="w-full sm:w-auto" onClick={handleSubmitCancelName} data-cy="cancel-name-next">
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "cancelSelect" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3" data-cy="cancel-select-list">
              <p className="text-sm text-muted-foreground">Selecione o agendamento que deseja cancelar:</p>
              <div className="space-y-2">
                {cancelMatches.map((apt) => (
                  <Button
                    key={apt.AgendamentoId}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => handleSelectCancelAppointment(apt.AgendamentoId)}
                    disabled={cancelLoading}
                    data-cy={`cancel-apt-${apt.AgendamentoId}`}
                  >
                    {formatTime(apt.HoraAgendada, apt.InicioEm)} - {apt.Servico || "Serviço"} ({apt.ClienteNome || "Cliente"})
                  </Button>
                ))}
              </div>
            </div>
          )}

          {step === "cancelRequest" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3" data-cy="cancel-done">
              <p className="text-sm text-muted-foreground">Envie a solicitação para o admin confirmar o cancelamento.</p>

              {cancelWhatsappUrl ? (
                <Button asChild className="w-full" data-cy="cancel-send-whatsapp">
                  <a href={cancelWhatsappUrl} target="_blank" rel="noreferrer">
                    <Send size={16} className="mr-2" />
                    Enviar solicitação no WhatsApp
                  </a>
                </Button>
              ) : (
                <p className="text-xs text-amber-600">
                  WhatsApp do estabelecimento não configurado. Peça para o dono preencher em Configurações.
                </p>
              )}

              <Button variant="outline" className="w-full" onClick={handleBackToMenu} data-cy="cancel-back-menu">
                Voltar ao menu
              </Button>
            </div>
          )}

          {showMenuShortcut && (
            <div className="pl-0 sm:pl-11">
              <Button variant="ghost" className="w-full sm:w-auto" onClick={handleBackToMenu} data-cy="chat-menu-shortcut">
                Voltar ao menu principal
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

