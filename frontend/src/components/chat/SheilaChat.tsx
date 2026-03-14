import { useEffect, useRef, useState } from "react";
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

type ChatStep =
  | "welcome"
  | "menu"
  | "services"
  | "selectDate"
  | "clientInfo"
  | "confirmation"
  | "quoteModel"
  | "quoteIssue"
  | "quoteReady";

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
  { id: "ajuda", label: "Falar com atendente", icon: HelpCircle },
];

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

  const { getActiveServices } = useServices();
  const { createAppointment } = useAppointments();
  const scrollRef = useRef<HTMLDivElement>(null);

  const availableMenuOptions =
    Array.isArray(initialOptions) && initialOptions.length > 0
      ? menuOptions.filter((option) => initialOptions.includes(option.id))
      : menuOptions;

  const services = getActiveServices();
  const whatsappDigits = sanitizeWhatsapp(providerWhatsapp);
  const quoteWhatsappUrl =
    quoteModel && quoteIssue && whatsappDigits
      ? `https://wa.me/${whatsappDigits}?text=${buildQuoteMessage(companyName, quoteModel, quoteIssue)}`
      : "";

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
      }
    }, 300);
  };

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
    addMessage("assistant", "Como posso te ajudar agora?");
    setStep("menu");
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

          {step === "selectDate" && selectedService && (
            <div className="pl-0 sm:pl-11">
              <DateTimePicker
                onSelect={handleDateTimeSelect}
                onBack={() => setStep("services")}
                serviceDuration={selectedService.duration}
                serviceId={selectedService.id}
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
        </div>
      </ScrollArea>
    </div>
  );
}
