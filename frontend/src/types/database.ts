// Types preparados para integração com SQL Server (SSMS)
// Essas interfaces representam as tabelas do banco de dados

export interface Service {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number; // em minutos
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkSchedule {
  id: string;
  dayOfWeek: number; // 0 = Domingo, 1 = Segunda, etc.
  startTime: string; // "08:00"
  endTime: string; // "18:00"
  active: boolean;
}

export interface Appointment {
  id: string;
  clientName: string;
  clientPhone: string;
  serviceId: string;
  serviceName: string;

  /**
   * Duração do serviço no momento do agendamento (em minutos).
   * Isso garante que o conflito de horários funcione corretamente,
   * mesmo se a duração do serviço mudar no futuro.
   */
  serviceDuration: number;

  date: string; // "2024-01-15"
  time: string; // "14:00"
  status: "pending" | "confirmed" | "completed" | "cancelled";
  notes?: string;
  createdAt: Date;
}

export interface BusinessConfig {
  id: string;
  businessName: string;
  ownerName: string;
  phone: string;
  address: string;
  slotDuration: number; // duração padrão de cada slot em minutos
}

// Mock data para desenvolvimento - substituir por chamadas SQL
export const mockServices: Service[] = [
  {
    id: "1",
    name: "Troca de Óleo",
    description: "Troca de óleo do motor com filtro incluso",
    price: 150,
    duration: 30,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "2",
    name: "Alinhamento e Balanceamento",
    description: "Alinhamento da direção e balanceamento das 4 rodas",
    price: 120,
    duration: 45,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "3",
    name: "Revisão Completa",
    description: "Revisão geral do veículo com checklist de 50 itens",
    price: 350,
    duration: 120,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "4",
    name: "Troca de Pastilhas de Freio",
    description: "Troca das pastilhas de freio dianteiras ou traseiras",
    price: 200,
    duration: 60,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "5",
    name: "Higienização de Ar Condicionado",
    description: "Limpeza e higienização completa do sistema de ar",
    price: 80,
    duration: 30,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export const mockWorkSchedule: WorkSchedule[] = [
  { id: "1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00", active: true },
  { id: "2", dayOfWeek: 2, startTime: "08:00", endTime: "18:00", active: true },
  { id: "3", dayOfWeek: 3, startTime: "08:00", endTime: "18:00", active: true },
  { id: "4", dayOfWeek: 4, startTime: "08:00", endTime: "18:00", active: true },
  { id: "5", dayOfWeek: 5, startTime: "08:00", endTime: "18:00", active: true },
  { id: "6", dayOfWeek: 6, startTime: "08:00", endTime: "12:00", active: true },
  { id: "7", dayOfWeek: 0, startTime: "00:00", endTime: "00:00", active: false },
];

export const mockBusinessConfig: BusinessConfig = {
  id: "1",
  businessName: "Serviços Automotivos do Nando",
  ownerName: "Fernando",
  phone: "51996359556",
  address: "Rua Exemplo, 123 - Centro",
  slotDuration: 30,
};
