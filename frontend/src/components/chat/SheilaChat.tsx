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
import { sendChatMessage } from "@/lib/api";
import { Service } from "@/types/database";
import { Calendar, Wrench, Clock, HelpCircle, SendHorizonal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
function isCancelIntentLocal(text: string) {
  const t = (text || "").toLowerCase();
  return (
    t.includes("cancelar") ||
    t.includes("cancelamento") ||
    t.includes("desmarcar") ||
    t.includes("desmarque") ||
    t.includes("remarcar") && t.includes("cancel") // defensive
  );
}

function normalizeDateToISO(input: string) {
  const raw = (input || "").trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // DD/MM or DD/MM/YYYY
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3] ? m[3] : String(new Date().getFullYear());
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

type ChatStep =
  | "welcome"
  | "menu"
  | "services"
  | "selectDate"
  | "clientInfo"
  | "confirmation"
  | "cancel_name"
  | "cancel_date"
  | "cancel_choose"
  | "cancel_confirm";

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
  

const [whatsappPrestador, setWhatsappPrestador] = useState<string | null>(null);

// Cancelamento V2 (2 passos)
const [cancelName, setCancelName] = useState<string>("");
const [cancelDateISO, setCancelDateISO] = useState<string>("");
const [cancelMatches, setCancelMatches] = useState<any[]>([]);
const [selectedCancelId, setSelectedCancelId] = useState<number | null>(null);
const [flowMode, setFlowMode] = useState<FlowMode>("booking");

  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");

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


const buildWhatsAppLink = (phoneDigits: string, message: string) => {
  const digits = String(phoneDigits || "").replace(/\D+/g, "");
  if (!digits) return null;
  return `https://wa.me/55${digits}?text=${encodeURIComponent(message)}`;
};

const getCurrentYearSP = () => {
  const now = new Date();
  const sp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return sp.getFullYear();
};

const parseDateToISO = (input: string): string | null => {
  const raw = String(input || "").trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // DD/MM/YYYY
  let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const dd = m[1], mm = m[2], yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // DD/MM
  m = raw.match(/^(\d{2})\/(\d{2})$/);
  if (m) {
    const dd = m[1], mm = m[2];
    const yyyy = String(getCurrentYearSP());
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
};

const postJson = async <T,>(url: string, body: any): Promise<T> => {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(txt || `HTTP ${resp.status}`);
  }

  return (await resp.json()) as T;
};

const startCancelV2 = () => {
  setCancelName("");
  setCancelDateISO("");
  setCancelMatches([]);
  setSelectedCancelId(null);

  addMessage(
    "assistant",
    `Sem problema 😊\n\nPara eu localizar seu agendamento, me diga *seu nome* (como está no agendamento).`
  );
  setStep("cancel_name");
};

const offerDirectWhatsApp = (reasonText?: string) => {
  const phone = whatsappPrestador;
  const baseMsg =
    "Olá! Preciso de ajuda com um cancelamento.\n" +
    (cancelName ? `\nNome: ${cancelName}` : "") +
    (cancelDateISO ? `\nData: ${cancelDateISO}` : "") +
    (reasonText ? `\n\nMotivo: ${reasonText}` : "");

  const link = phone ? buildWhatsAppLink(phone, baseMsg) : null;

  if (link) {
    addMessage("assistant", `Se preferir, fale direto com o prestador pelo WhatsApp:\n${link}`);
  } else {
    addMessage("assistant", "Se preferir, fale direto com o prestador pelo WhatsApp.");
  }
};

  const handleFreeTextSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setSending(true);
    setInputText("");
    addMessage("user", text);


// ✅ Intercepta intenção de cancelamento no próprio front para evitar duplicidade de mensagens
if (!["cancel_name","cancel_date","cancel_choose","cancel_confirm"].includes(step) && isCancelIntentLocal(text)) {
  startCancelV2();
  setSending(false);
  return;
}


// Fluxo de cancelamento V2 (2 passos)
if (step === "cancel_name") {
  const name = text;
  setCancelName(name);
  addMessage(
    "assistant",
    `Perfeito, ${name}! 😊\n\nAgora me informe a *data do atendimento* (ex: 27/01 ou 2026-01-27).`
  );
  setStep("cancel_date");
  setSending(false);
  return;
}

if (step === "cancel_date") {
  const iso = parseDateToISO(text);
  if (!iso) {
    addMessage(
      "assistant",
      "Não consegui entender a data 😕\n\nMe informe no formato 27/01 ou 2026-01-27."
    );
    setSending(false);
    return;
  }

  setCancelDateISO(iso);

  try {
    const resp: any = await postJson(
      `/api/empresas/${EMPRESA_SLUG}/cancelamentos/buscar`,
      { clientName: cancelName, date: iso }
    );

    if (resp.type === "blocked") {
      addMessage("assistant", resp.content);
      offerDirectWhatsApp("Cancelamento no mesmo dia");
      setStep("menu");
      setSending(false);
      return;
    }

    if (resp.type === "none") {
      addMessage("assistant", resp.content);
      offerDirectWhatsApp("Dificuldade para localizar o agendamento");
      addMessage(
        "assistant",
        "Vamos tentar de novo? Me diga *seu nome* (como está no agendamento)."
      );
      setStep("cancel_name");
      setSending(false);
      return;
    }

    const matches = Array.isArray(resp.matches) ? resp.matches : [];
    setCancelMatches(matches);

    if (matches.length === 1) {
      const a = matches[0];
      setSelectedCancelId(a.id);

      addMessage(
        "assistant",
        `Encontrei este agendamento:\n\n• Serviço: ${a.service}\n• Data: ${a.date}\n• Hora: ${a.time || "-"}\n\nConfirma que é esse que você quer cancelar? (responda: *sim* ou *não*)`
      );

      setStep("cancel_confirm");
      setSending(false);
      return;
    }

    const list = matches
      .map((a: any, idx: number) => `${idx + 1}) ${a.service} — ${a.date} ${a.time || ""}`.trim())
      .join("\n");

    addMessage(
      "assistant",
      `Encontrei ${matches.length} agendamentos. Qual você quer cancelar?\n\n${list}\n\nResponda com o número (ex: 1).`
    );
    setStep("cancel_choose");
    setSending(false);
    return;
  } catch (e: any) {
    addMessage(
      "assistant",
      "Ops! Tive um problema ao buscar seu agendamento 😕. Tenta novamente ou fale direto com o prestador no WhatsApp."
    );
    offerDirectWhatsApp("Erro ao buscar agendamento");
    setStep("menu");
    setSending(false);
    return;
  }
}

if (step === "cancel_choose") {
  const n = Number(String(text).trim());
  if (!Number.isFinite(n) || n < 1 || n > cancelMatches.length) {
    addMessage("assistant", `Me diga apenas o número da opção (1 a ${cancelMatches.length}).`);
    setSending(false);
    return;
  }

  const a = cancelMatches[n - 1];
  setSelectedCancelId(a.id);

  addMessage(
    "assistant",
    `Você escolheu:\n\n• Serviço: ${a.service}\n• Data: ${a.date}\n• Hora: ${a.time || "-"}\n\nConfirma que é esse que você quer cancelar? (responda: *sim* ou *não*)`
  );
  setStep("cancel_confirm");
  setSending(false);
  return;
}

if (step === "cancel_confirm") {
  const t = String(text).trim().toLowerCase();
  const yes = ["sim", "s", "confirmo", "confirmar", "ok", "pode", "isso"];
  const no = ["não", "nao", "n", "voltar", "errado"];

  if (yes.includes(t)) {
    try {
      const resp: any = await postJson(
        `/api/empresas/${EMPRESA_SLUG}/cancelamentos/gerar-link`,
        { appointmentId: selectedCancelId }
      );

      addMessage("assistant", resp.content);

      if (resp.waLink) {
        addMessage("assistant", `✅ Link do WhatsApp:\n${resp.waLink}`);
      }

      setStep("menu");
      setSending(false);
      return;
    } catch (e: any) {
      addMessage(
        "assistant",
        "Não consegui gerar o link agora 😕. Você pode falar direto com o prestador no WhatsApp."
      );
      offerDirectWhatsApp("Erro ao gerar link");
      setStep("menu");
      setSending(false);
      return;
    }
  }

  if (no.includes(t)) {
    addMessage(
      "assistant",
      "Sem problema 😊\n\nMe diga *seu nome* novamente para eu localizar o agendamento certo."
    );
    setStep("cancel_name");
    setSending(false);
    return;
  }

  addMessage("assistant", "Responda com *sim* para confirmar ou *não* para voltar.");
  setSending(false);
  return;
}

    try {
      const resp = await sendChatMessage(EMPRESA_SLUG, text);

      // ✅ Evita duplicidade no cancelamento: se vier START_CANCEL_V2, o front guia o fluxo
      if (resp.type === "action" && resp.action === "START_CANCEL_V2") {
        startCancelV2();
        return;
      }

      // Resposta simples
      addMessage("assistant", resp.content);
// Guarda WhatsApp do prestador quando vier no meta
      if ((resp as any).meta && (resp as any).meta.whatsappPrestador) {
        setWhatsappPrestador(String((resp as any).meta.whatsappPrestador));
      }

      // Ações
      if (resp.type === "action") {
        if (resp.action === "START_MENU") {
          setStep("menu");
        } else if (resp.action === "START_CANCEL_V2") {
          startCancelV2();
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
