import { buildWhatsAppUrlWithText } from "@/lib/whatsapp";

export type AppointmentReminderInput = {
  clienteNome?: string | null;
  servico?: string | null;
  dataAgendada?: string | null;
  horaAgendada?: string | null;
  empresaNome?: string | null;
  profissionalNome?: string | null;
  clienteWhatsapp?: string | null;
  clienteTelefone?: string | null;
};

function parseLocalDateLabel(dateValue?: string | null) {
  const raw = String(dateValue || "").trim();
  const ymd = raw.slice(0, 10);
  const parts = ymd.split("-").map((value) => Number(value));
  const [year, month, day] = parts;

  if (
    Number.isFinite(year) &&
    Number.isFinite(month) &&
    Number.isFinite(day) &&
    year > 1900 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31
  ) {
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }

  return "data combinada";
}

function parseHourLabel(horaAgendada?: string | null) {
  const value = String(horaAgendada || "").trim();
  if (!value) return "horário combinado";
  if (value.includes("T")) return value.slice(11, 16) || "horário combinado";
  if (value.length >= 5 && value.includes(":")) return value.slice(0, 5);
  return "horário combinado";
}

export function getAppointmentContactPhone(input: AppointmentReminderInput) {
  return String(input.clienteWhatsapp || input.clienteTelefone || "").trim();
}

export function buildAppointmentReminderMessage(input: AppointmentReminderInput) {
  const cliente = String(input.clienteNome || "cliente").trim() || "cliente";
  const servico = String(input.servico || "seu serviço").trim() || "seu serviço";
  const data = parseLocalDateLabel(input.dataAgendada);
  const hora = parseHourLabel(input.horaAgendada);
  const empresa = String(input.empresaNome || "nossa equipe").trim() || "nossa equipe";
  const profissional = String(input.profissionalNome || "").trim();

  const profissionalLine = profissional ? ` Profissional: ${profissional}.` : "";

  return `Olá, ${cliente}! Passando para lembrar do seu agendamento em ${empresa} no dia ${data} às ${hora}, para ${servico}.${profissionalLine} Se precisar de qualquer ajuste, nos avise.`;
}

export function buildAppointmentReminderWhatsAppUrl(input: AppointmentReminderInput) {
  const phone = getAppointmentContactPhone(input);
  const message = buildAppointmentReminderMessage(input);
  return buildWhatsAppUrlWithText(phone, message);
}
