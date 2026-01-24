import { useState, useEffect, useRef } from "react";
import { SheilaAvatar } from "./SheilaAvatar";
import { ChatMessage } from "./ChatMessage";
import { ChatOptions, ChatOption } from "./ChatOptions";
import { ServiceCard } from "./ServiceCard";
import { DateTimePicker } from "./DateTimePicker";
import { ClientForm } from "./ClientForm";
import { BookingConfirmation } from "./BookingConfirmation";
import { useServices } from "@/hooks/useServices";
import { useAppointments } from "@/hooks/useAppointments";
import { apiPost, sendChatMessage } from "@/lib/api";
import { Service } from "@/types/database";
import { Calendar, Wrench, Clock, HelpCircle, SendHorizonal, XCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ChatStep =
  | "welcome"
  | "menu"
  | "services"
  | "selectDate"
  | "clientInfo"
  | "confirmation"
  | "cancelCollect"
  | "cancelPick"
  | "cancelConfirm"
  | "cancelWhatsapp"
  | "cancelBlocked";

type FlowMode = "booking" | "availability" | "browse";

interface Message {
  role: "assistant" | "user";
  content: string;
}

type SheilaChatProps = {
  companyName?: string;
  welcomeMessage?: string;
};

// Por enquanto usamos apenas o slug do Nando.
// No futuro, você pode tornar isso dinâmico lendo da URL (?empresa=slug).
const EMPRESA_SLUG = "nando";

const menuOptions: ChatOption[] = [
  { id: "agendar", label: "Agendar serviço", icon: Calendar },
  { id: "servicos", label: "Ver serviços", icon: Wrench },
  { id: "horarios", label: "Horários disponíveis", icon: Clock },
  { id: "cancelar", label: "Cancelar agendamento", icon: XCircle },
  { id: "ajuda", label: "Falar com atendente", icon: HelpCircle },
];

function buildDefaultWelcome(companyName?: string) {
  const nome = companyName?.trim() || "a empresa";
  return (
    `Olá! 👋 Eu sou a Sheila, assistente virtual da ${nome}!\n\n` +
    "Estou aqui para te ajudar com agendamentos e informações sobre nossos serviços. Como posso te ajudar hoje?"
  );
}

// ✅ helper: garante que o serviceId seja number
function toServiceIdNumber(service: Service | null): number | null {
  if (!service) return null;
  const raw = (service as any).id ?? (service as any).Id;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function SheilaChat({ companyName, welcomeMessage }: SheilaChatProps) {
  const [step, setStep] = useState<ChatStep>("welcome");
  const [flowMode, setFlowMode] = useState<FlowMode>("booking");

  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  // ✅ cancelamento (V2)
  const [cancelName, setCancelName] = useState("");
  const [cancelDate, setCancelDate] = useState("");
  const [cancelMatches, setCancelMatches] = useState<any[]>([]);
  const [cancelSelectedId, setCancelSelectedId] = useState<number | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // ✅ input de texto livre
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);

  const { getActiveServices } = useServices();
  const { createAppointment } = useAppointments();
  const scrollRef = useRef<HTMLDivElement>(null);

  const services = getActiveServices();

  useEffect(() => {
    const msg =
      (welcomeMessage && welcomeMessage.trim()) || buildDefaultWelcome(companyName);

    const timer = setTimeout(() => {
      setMessages([{ role: "assistant", content: msg }]);
      setStep("menu");

      setFlowMode("booking");
      setSelectedService(null);
      setSelectedDate("");
      setSelectedTime("");
      setClientName("");
      setClientPhone("");
      setInputText("");
      setSending(false);
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

  const shouldGoToBooking = (text: string) => {
    const t = text.toLowerCase();
    const keywords = [
      "agendar",
      "marcar",
      "agenda",
      "horário",
      "horario",
      "serviço",
      "servico",
      "lavagem",
      "polimento",
      "revisão",
      "revisao",
    ];
    return keywords.some((k) => t.includes(k));
  };

  const handleFreeTextSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setSending(true);
    setInputText("");
    addMessage("user", text);

    try {
      const resp = await sendChatMessage(EMPRESA_SLUG, text);

      // Resposta simples
      addMessage("assistant", resp.content);

      // Ações (fluxos guiados)
      if (resp.type === "action") {
        if (resp.action === "START_CANCEL_V2") {
          setStep("cancelCollect");
          setCancelName("");
          setCancelDate("");
          setCancelMatches([]);
          setCancelSelectedId(null);
          return;
        }
        if (resp.action === "START_MENU") {
          setStep("menu");
          return;
        }
      }
// Ações (placeholder por enquanto)
      if (resp.type === "action") {
        if (resp.action === "START_MENU") {
          setStep("menu");
        } else {
          // caso venha outra ação no futuro
          setStep("menu");
        }
      } else {
        // por enquanto sempre volta ao menu para o usuário escolher o fluxo
        setStep("menu");
      }
    } catch (e) {
      addMessage(
        "assistant",
        "Ops! Tive um problema para responder agora 😕. Tenta novamente em alguns segundos."
      );
      setStep("menu");
    } finally {
      setSending(false);
    }
  };

  const handleMenuSelect = (option: ChatOption) => {
    addMessage("user", option.label);

    setTimeout(() => {
      switch (option.id) {
        case "agendar": {
          setFlowMode("booking");
          addMessage(
            "assistant",
            "Ótimo! Aqui estão nossos serviços disponíveis. Escolha um para agendar: 🔧"
          );
          setStep("services");
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
          addMessage(
            "assistant",
            "Perfeito! Para ver horários disponíveis, primeiro escolha o serviço que você deseja: ⏰"
          );
          setStep("services");
          break;
        }

        case "cancelar": {
          setStep("cancelCollect");
          setCancelName("");
          setCancelDate("");
          setCancelMatches([]);
          setCancelSelectedId(null);
          addMessage(
            "assistant",
            "Sem problema 🙂 Para eu localizar seu agendamento, me informe *seu nome* e a *data do atendimento* (ex: 24/01 ou 2026-01-24)."
          );
          break;
        }

        case "ajuda": {
          addMessage(
            "assistant",
            "Sem problemas! Você pode entrar em contato diretamente pelo WhatsApp: (11) 99999-9999\n\nOu se preferir, posso continuar te atendendo por aqui! 😊"
          );
          setTimeout(() => setStep("menu"), 100);
          break;
        }
      }
    }, 300);
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
      setStep("selectDate");
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
      addMessage(
        "assistant",
        "Ops! Não consegui identificar o serviço. Vamos escolher o serviço novamente."
      );
      setStep("services");
      return;
    }

    const serviceIdNumber = toServiceIdNumber(selectedService);
    if (!serviceIdNumber) {
      addMessage(
        "assistant",
        "Ops! Não consegui identificar o ID do serviço. Vamos escolher o serviço novamente."
      );
      setSelectedService(null);
      setStep("services");
      return;
    }

    try {
      // ✅ alinhado com CreateAppointmentInput do useAppointments.ts
      await createAppointment({
        clientName: name,
        clientPhone: phone,
        serviceId: serviceIdNumber,
        date: selectedDate,
        time: selectedTime,
        observation: notes || undefined,
      });

      addMessage("user", `Nome: ${name}, Telefone: ${phone}`);

      setTimeout(() => {
        addMessage(
          "assistant",
          "🎉 Agendamento realizado com sucesso! Confira os detalhes abaixo e confirme pelo WhatsApp:"
        );
        setStep("confirmation");
      }, 300);
    } catch (err) {
      setStep("clientInfo");
    }
  };

  const handleNewBooking = () => {
    setFlowMode("booking");
    setSelectedService(null);
    setSelectedDate("");
    setSelectedTime("");
    setClientName("");
    setClientPhone("");
    addMessage("assistant", "Como posso te ajudar agora?");
    setStep("menu");
  };


  async function searchCancellation() {
    const name = cancelName.trim();
    const date = cancelDate.trim();
    if (!name || !date) {
      addMessage("assistant", "Me manda *seu nome* e a *data do atendimento* para eu localizar 😊");
      return;
    }

    setCancelLoading(true);
    try {
      const resp = await apiPost<any>(`/api/empresas/${EMPRESA_SLUG}/cancelamentos/buscar`, {
        clientName: name,
        date,
      });

      addMessage("user", `Cancelar: ${name} • ${date}`);

      if (resp.type === "text") {
        addMessage("assistant", resp.content);
        setStep("menu");
        return;
      }

      setCancelMatches(resp.matches || []);
      setStep("cancelPick");
    } catch (e: any) {
      addMessage(
        "assistant",
        e?.message || "Tive um probleminha para localizar seu agendamento 😕 Tente novamente."
      );
      setStep("menu");
    } finally {
      setCancelLoading(false);
    }
  }

  async function generateCancellationLink(appointmentId: number) {
    setCancelLoading(true);
    try {
      const resp = await apiPost<any>(`/api/empresas/${EMPRESA_SLUG}/cancelamentos/gerar-link`, {
        appointmentId,
      });

      addMessage("assistant", resp.content);

      if (resp.type === "whatsapp" && resp.waLink) {
        addMessage("assistant", `👉 ${resp.waLink}`);
      }

      setStep("menu");
    } catch (e: any) {
      addMessage(
        "assistant",
        e?.message || "Não consegui gerar o link agora 😕 Tente novamente."
      );
      setStep("menu");
    } finally {
      setCancelLoading(false);
    }
  }

  const canSend = inputText.trim().length > 0 && !sending;
  const selectedServiceIdNumber = toServiceIdNumber(selectedService);

  return (
    <div className="flex flex-col h-full">
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

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4 pb-4">
          {messages.map((msg, idx) => (
            <ChatMessage key={idx} role={msg.role} content={msg.content} />
          ))}

          {step === "menu" && (
            <div className="pl-11">
              <ChatOptions options={menuOptions} onSelect={handleMenuSelect} />
            </div>
          )}

          {step === "services" && (
            <div className="pl-11 space-y-3">
              {services.map((service) => (
                <ServiceCard
                  key={(service as any).id ?? (service as any).Id}
                  service={service}
                  onSelect={handleServiceSelect}
                />
              ))}
            </div>
          )}

          {step === "selectDate" && selectedService && selectedServiceIdNumber && (
            <div className="pl-11">
              <DateTimePicker
                onSelect={handleDateTimeSelect}
                onBack={() => setStep("services")}
                serviceDuration={selectedService.duration}
                serviceId={selectedServiceIdNumber}
              />
            </div>
          )}

          {step === "clientInfo" && (
            <div className="pl-11">
              <ClientForm
                onSubmit={handleClientSubmit}
                onBack={() => setStep("selectDate")}
              />
            </div>
          )}

          {step === "confirmation" && selectedService && (
            <div className="pl-11">
              <BookingConfirmation
                service={selectedService}
                date={selectedDate}
                time={selectedTime}
                clientName={clientName}
                clientPhone={clientPhone}
                onNewBooking={handleNewBooking}
              />
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-end gap-2">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Digite sua mensagem…"
            className="min-h-[44px] max-h-[120px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleFreeTextSend();
              }
            }}
            disabled={sending}
          />

          <Button onClick={handleFreeTextSend} disabled={!canSend} className="h-[44px]">
            <SendHorizonal className="w-4 h-4" />
          </Button>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          Dica: pressione <b>Enter</b> para enviar e <b>Shift+Enter</b> para quebrar linha.
        </p>
      </div>
    </div>
  );
}
