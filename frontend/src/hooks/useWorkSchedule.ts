import { useState, useEffect } from 'react';
import { WorkSchedule, mockWorkSchedule } from '@/types/database';

// Hook para gerenciar horários de trabalho
// Preparado para substituir localStorage por chamadas SQL

export function useWorkSchedule() {
  const [schedule, setSchedule] = useState<WorkSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSchedule();
  }, []);

  const loadSchedule = () => {
    // TODO: Substituir por chamada SQL
    // SELECT * FROM WorkSchedule ORDER BY dayOfWeek
    const stored = localStorage.getItem('workSchedule');
    if (stored) {
      setSchedule(JSON.parse(stored));
    } else {
      setSchedule(mockWorkSchedule);
      localStorage.setItem('workSchedule', JSON.stringify(mockWorkSchedule));
    }
    setLoading(false);
  };

  const saveSchedule = (newSchedule: WorkSchedule[]) => {
    // TODO: Substituir por chamada SQL
    localStorage.setItem('workSchedule', JSON.stringify(newSchedule));
    setSchedule(newSchedule);
  };

  const updateDaySchedule = (dayOfWeek: number, data: Partial<WorkSchedule>) => {
    // TODO: Substituir por UPDATE WorkSchedule WHERE dayOfWeek = @day
    const updated = schedule.map(day => 
      day.dayOfWeek === dayOfWeek ? { ...day, ...data } : day
    );
    saveSchedule(updated);
  };

  const getDayName = (dayOfWeek: number): string => {
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    return days[dayOfWeek];
  };

  const getAvailableSlots = (date: Date, slotDuration: number = 30): string[] => {
    const dayOfWeek = date.getDay();
    const daySchedule = schedule.find(s => s.dayOfWeek === dayOfWeek);
    
    if (!daySchedule || !daySchedule.active) {
      return [];
    }

    const slots: string[] = [];
    const [startHour, startMin] = daySchedule.startTime.split(':').map(Number);
    const [endHour, endMin] = daySchedule.endTime.split(':').map(Number);
    
    let currentTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    while (currentTime < endTime) {
      const hours = Math.floor(currentTime / 60);
      const mins = currentTime % 60;
      slots.push(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`);
      currentTime += slotDuration;
    }

    return slots;
  };

  return {
    schedule,
    loading,
    updateDaySchedule,
    getDayName,
    getAvailableSlots,
    refresh: loadSchedule,
  };
}
