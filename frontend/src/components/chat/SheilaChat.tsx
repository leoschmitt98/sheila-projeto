import { useEffect, useMemo, useRef, useState } from "react";
import { SheilaAvatar } from "./SheilaAvatar";
import { ChatMessage } from "./ChatMessage";
import { ChatOptions, ChatOption } from "./ChatOptions";
import { ServiceCard } from "./ServiceCard";
import { DateTimePicker } from "./DateTimePicker";
import { ClientForm } from "./ClientForm";
import { BookingConfirmation } from "./BookingConfirmation";
import { useServices } from "@/hooks/useServices";
import { useAppointments } from "@/hooks/useAppointments";
import { Service } from "@/types/database";
import { Calendar, Wrench, Clock, HelpCircle, ClipboardList, Send } from "lucide-react";
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
  | "quoteModel"
  | "quoteIssue"
  | "quoteReady"
  | "cancelDate"
  | "cancelName"
  | "cancelPhone"
  | "cancelSelect"
  | "cancelRequest";

type FlowMode = "booking" | "availability" | "browse" | "quote";

interface Message {
  role: "assistant" | "user";
  content: string;
}

type SheilaChatProps = {
  companyName?: string;
  welcomeMessage?: string;
  providerWhatsapp?: string | null;
  initialOptions?: string[] | null;
};

const menuOptions: ChatOption[] = [
  { id: "agendar", label: "Agendar serviço", icon: Calendar },
  { id: "orcamento", label: "Solicitar orçamento", icon: ClipboardList },
  { id: "servicos", label: "Ver serviços", icon: Wrench },
  { id: "horarios", label: "Horários disponíveis", icon: Clock },
  { id: "cancelar", label: "Cancelar agendamento", icon: Calendar },
  { id: "ajuda", label: "Falar com atendente", icon: HelpCircle },
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

function buildQuoteMessage(companyName: string | undefined, model: string, issue: string) {
  const empresa = companyName?.trim() || "Assistência Técnica";
  return (
    `Olá, equipe ${empresa}! Tudo bem?%0A%0A` +
    `Gostaria de solicitar um orçamento:%0A` +
    `• Modelo do aparelho: ${encodeURIComponent(model)}%0A` +
    `• Defeito relatado: ${encodeURIComponent(issue)}%0A%0A` +
    `Fico no aguardo de uma estimativa inicial, por favor.`
  );
}

export function SheilaChat({ companyName, welcomeMessage, providerWhatsapp, initialOptions }: SheilaChatProps) {
  const [step, setStep] = useState<ChatStep>("welcome");
  const [flowMode, setFlowMode] = useState<FlowMode>("booking");

  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");

  const [quoteModel, setQuoteModel] = useState("");
  const [quoteIssue, setQuoteIssue] = useState("");
  const [cancelDate, setCancelDate] = useState("");
  const [cancelName, setCancelName] = useState("");
  const [cancelPhone, setCancelPhone] = useState("");
  const [cancelMatches, setCancelMatches] = useState<CancelAppointment[]>([]);
  const [cancelSelected, setCancelSelected] = useState<CancelAppointment | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [professionals, setProfessionals] = useState<Profissional[]>([]);
  const [selectedProfessional, setSelectedProfessional] = useState<Profissional | null>(null);

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
    return menuOptions.filter((option) => enabled.has(option.id));
  })();

  const services = getActiveServices();
  const whatsappDigits = sanitizeWhatsapp(providerWhatsapp);
  const whatsappTarget =
    whatsappDigits && !whatsappDigits.startsWith("55") && (whatsappDigits.length === 10 || whatsappDigits.length === 11)
      ? `55${whatsappDigits}`
      : whatsappDigits;
  const quoteWhatsappUrl =
    quoteModel && quoteIssue && whatsappTarget
      ? `https://wa.me/${whatsappTarget}?text=${buildQuoteMessage(companyName, quoteModel, quoteIssue)}`
      : "";

  const activeProfessionals = useMemo(
    () => professionals.filter((p) => p.Ativo !== false),
    [professionals]
  );
  const requiresProfessionalSelection = activeProfessionals.length > 1;

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
      setQuoteModel("");
      setQuoteIssue("");
      setCancelDate("");
      setCancelName("");
      setCancelPhone("");
      setCancelMatches([]);
      setCancelSelected(null);
      setCancelLoading(false);
      setSelectedProfessional(null);
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

  const handleMenuSelect = (option: ChatOption) => {
    addMessage("user", option.label);

    setTimeout(() => {
      switch (option.id) {
        case "agendar": {
          setFlowMode("booking");
          setSelectedProfessional(null);
          addMessage("assistant", "Ótimo! Aqui estão nossos serviços disponíveis. Escolha um para agendar: 🔧");
          setStep("services");
          break;
        }

        case "orcamento": {
          setFlowMode("quote");
          setQuoteModel("");
          setQuoteIssue("");
          addMessage(
            "assistant",
            "Perfeito! Vou te ajudar com o orçamento. Primeiro, me diga o modelo do item que você deseja avaliar."
          );
          setStep("quoteModel");
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
            whatsappDigits
              ? `Sem problemas! Você pode entrar em contato diretamente pelo WhatsApp: ${providerWhatsapp}\n\nOu se preferir, posso continuar te atendendo por aqui! 😊`
              : "Sem problemas! Posso continuar te atendendo por aqui. Se quiser, peça um orçamento e eu preparo uma mensagem pronta para o técnico. 😊"
          );
          setTimeout(() => setStep("menu"), 100);
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
    if (!iso) return;

    setCancelDate(iso);
    addMessage("user", `Data do agendamento: ${iso}`);
    addMessage("assistant", "Agora me informe o nome usado no agendamento.");
    setStep("cancelName");
  };

  const handleSubmitCancelName = () => {
    const name = cancelName.trim();
    if (!name) return;

    setCancelName(name);
    addMessage("user", `Nome: ${name}`);
    addMessage("assistant", "Perfeito! Agora me informe o telefone usado no agendamento (com DDD). Ex: 11999999999");
    setStep("cancelPhone");
  };

  const handleSubmitCancelPhone = async () => {
    const phoneDigits = cancelPhone.replace(/\D/g, "");
    if (phoneDigits.length < 10) return;

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

  const handleSubmitQuoteModel = () => {
    const model = quoteModel.trim();
    if (!model) return;

    addMessage("user", `Modelo do aparelho: ${model}`);
    addMessage("assistant", "Perfeito! Agora me descreva o defeito do aparelho para eu preparar a mensagem para o técnico.");
    setStep("quoteIssue");
  };

  const handleSubmitQuoteIssue = () => {
    const issue = quoteIssue.trim();
    if (!issue) return;

    addMessage("user", `Defeito informado: ${issue}`);

    const preview =
      "✅ Orçamento pré-cadastrado!\n\n" +
      `• Modelo: ${quoteModel.trim()}\n` +
      `• Defeito: ${issue}\n\n` +
      "Agora você pode enviar essa mensagem para o WhatsApp do técnico e receber um valor aproximado.";

    addMessage("assistant", preview);
    setStep("quoteReady");
  };

  const handleServiceSelect = (service: Service) => {
    setSelectedService(service);
    addMessage("user", `${service.name}`);

    setTimeout(() => {
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
        addMessage("assistant", "Antes de continuar, escolha o profissional do atendimento:");
        setStep("chooseProfessional");
      } else {
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
    setClientName(name);
    setClientPhone(phone);

    if (!selectedService) {
      addMessage("assistant", "Ops! Não consegui identificar o serviço. Vamos escolher o serviço novamente.");
      setStep("services");
      return;
    }

    try {
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
          "🎉 Agendamento realizado com sucesso! Confira os detalhes abaixo e confirme pelo WhatsApp:"
        );
        setStep("confirmation");
      }, 300);
    } catch {
      setStep("clientInfo");
    }
  };

  const handleBackToMenu = () => {
    setFlowMode("booking");
    setSelectedService(null);
    setSelectedDate("");
    setSelectedTime("");
    setClientName("");
    setClientPhone("");
    setQuoteModel("");
    setQuoteIssue("");
    setCancelDate("");
    setCancelName("");
    setCancelPhone("");
    setCancelMatches([]);
    setCancelSelected(null);
    setCancelLoading(false);
    setSelectedProfessional(null);
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


          {step === "chooseProfessional" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3" data-cy="choose-professional">
              <p className="text-sm text-muted-foreground">Escolha com qual profissional você deseja agendar:</p>
              <div className="space-y-2">
                {activeProfessionals.map((professional) => (
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
              <ClientForm onSubmit={handleClientSubmit} onBack={() => setStep("selectDate")} />
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
                confirmWhatsapp={selectedProfessional?.Whatsapp || providerWhatsapp || null}
              />
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
                  Gerar mensagem
                </Button>
              </div>
            </div>
          )}

          {step === "quoteReady" && (
            <div className="pl-0 sm:pl-11 rounded-lg border border-border/60 p-3 space-y-3" data-cy="quote-ready">
              <p className="text-sm text-muted-foreground">Mensagem pronta para o técnico:</p>
              <div className="rounded-md bg-secondary/40 p-3 text-sm whitespace-pre-wrap">
                Modelo: {quoteModel}\nDefeito: {quoteIssue}
              </div>

              {quoteWhatsappUrl ? (
                <Button asChild className="w-full" data-cy="quote-send-whatsapp">
                  <a href={quoteWhatsappUrl} target="_blank" rel="noreferrer">
                    <Send size={16} className="mr-2" />
                    Enviar para WhatsApp
                  </a>
                </Button>
              ) : (
                <p className="text-xs text-amber-600">
                  WhatsApp do estabelecimento não configurado. Peça para o dono preencher em Configurações.
                </p>
              )}

              <Button variant="outline" className="w-full" onClick={handleBackToMenu} data-cy="quote-new-request">
                Novo atendimento
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
        </div>
      </ScrollArea>
    </div>
  );
}
