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
import { Service } from "@/types/database";
import { Calendar, Wrench, Clock, HelpCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

type ChatStep =
  | "welcome"
  | "menu"
  | "services"
  | "selectDate"
  | "clientInfo"
  | "confirmation";

type FlowMode = "booking" | "availability" | "browse";

interface Message {
  role: "assistant" | "user";
  content: string;
}

type SheilaChatProps = {
  companyName?: string;
  welcomeMessage?: string;
};

const menuOptions: ChatOption[] = [
  { id: "agendar", label: "Agendar serviço", icon: Calendar },
  { id: "servicos", label: "Ver serviços", icon: Wrench },
  { id: "horarios", label: "Horários disponíveis", icon: Clock },
  { id: "ajuda", label: "Falar com atendente", icon: HelpCircle },
];

function buildDefaultWelcome(companyName?: string) {
  const nome = companyName?.trim() || "a empresa";
  return (
    `Olá! 👋 Eu sou a Sheila, assistente virtual da ${nome}!\n\n` +
    "Estou aqui para te ajudar com agendamentos e informações sobre nossos serviços. Como posso te ajudar hoje?"
  );
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return "Não foi possível concluir o agendamento.";
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

  const { getActiveServices } = useServices();
  const { createAppointment } = useAppointments();
  const scrollRef = useRef<HTMLDivElement>(null);

  const services = getActiveServices();

  // Inicializa (ou reinicializa) o chat quando mudar a empresa / mensagem
  useEffect(() => {
    const msg =
      (welcomeMessage && welcomeMessage.trim()) || buildDefaultWelcome(companyName);

    const timer = setTimeout(() => {
      setMessages([{ role: "assistant", content: msg }]);
      setStep("menu");

      // reset do fluxo quando muda de empresa
      setFlowMode("booking");
      setSelectedService(null);
      setSelectedDate("");
      setSelectedTime("");
      setClientName("");
      setClientPhone("");
    }, 300);

    return () => clearTimeout(timer);
  }, [companyName, welcomeMessage]);

  // Auto-scroll quando mensagens/step mudam
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
      // Modo "browse": só informa e volta ao menu
      if (flowMode === "browse") {
        addMessage(
          "assistant",
          `✅ Serviço: "${service.name}"\n⏱️ Duração: ${service.duration} minutos\n\nSe quiser agendar, selecione "Agendar serviço" no menu.`
        );
        setSelectedService(null);
        setStep("menu");
        return;
      }

      // Modo "availability" ou "booking": segue para seleção de data/hora
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

  // ✅ some com o DateTimePicker imediatamente
  if (flowMode === "availability") {
    setStep("menu");
    setTimeout(() => {
      addMessage(
        "assistant",
        "✅ Esse horário está selecionado.\n\nSe você quiser confirmar um agendamento, clique em 'Agendar serviço' no menu e escolha o serviço novamente (na próxima etapa vamos deixar isso direto)."
      );

      // Reset leve
      setSelectedService(null);
      setSelectedDate("");
      setSelectedTime("");
    }, 200);

    return;
  }

  // ✅ no modo booking vai direto para clientInfo
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

  try {
    await createAppointment({
      clientName: name,
      clientPhone: phone,
      serviceId: Number(selectedService.id),
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
  } catch (err) {
    // aqui você pode só voltar pro selectDate SEM mandar aquela mensagem grande
    // mas, na prática, com o PASSO 2 o horário nem aparece mais.
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4 pb-4">
          {messages.map((msg, idx) => (
            <ChatMessage key={idx} role={msg.role} content={msg.content} />
          ))}

          {/* Dynamic Content */}
          {step === "menu" && (
            <div className="pl-11">
              <ChatOptions options={menuOptions} onSelect={handleMenuSelect} />
            </div>
          )}

          {step === "services" && (
            <div className="pl-11 space-y-3">
              {services.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  onSelect={handleServiceSelect}
                />
              ))}
            </div>
          )}

          {step === "selectDate" && selectedService && (
            <div className="pl-11">
              <DateTimePicker
                onSelect={handleDateTimeSelect}
                onBack={() => setStep("services")}
                serviceDuration={selectedService.duration}
                serviceId={selectedService.id}
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
    </div>
  );
}
