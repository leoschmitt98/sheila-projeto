import { useState } from "react";
import { apiPost } from "@/lib/api";
import { getEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useVoiceRecognition } from "./useVoiceRecognition";

export type VoiceInterpretResponse = {
  success: boolean;
  intent: string;
  message: string;
  receivedText?: string;
  servicesDetected?: Array<{
    id: number;
    name: string;
    durationMin: number;
  }>;
  date?: string;
  slots?: string[];
  nextStep?: string;
  error?: string;
};

type VoiceButtonProps = {
  onVoiceProcessed?: (payload: {
    transcript: string;
    response: VoiceInterpretResponse;
  }) => void;
};

export function VoiceButton({ onVoiceProcessed }: VoiceButtonProps) {
  const { transcript, listening, startListening, stopListening } =
    useVoiceRecognition();
  const empresaSlug = getEmpresaSlug();
  const [apiResponse, setApiResponse] = useState<VoiceInterpretResponse | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const showInlineApiResponse = !onVoiceProcessed;

  const handleClick = () => {
    if (listening) {
      stopListening();
      return;
    }

    startListening();
  };

  const handleSendToBackend = async () => {
    const text = transcript.trim();
    if (!text) {
      setError("Nenhum texto reconhecido para enviar.");
      setApiResponse(null);
      return;
    }

    try {
      setSending(true);
      setError("");
      const response = await apiPost<VoiceInterpretResponse>("/api/voice/interpret", {
        text,
        slug: empresaSlug,
      });
      setApiResponse(response);
      onVoiceProcessed?.({ transcript: text, response });
    } catch (err: any) {
      setApiResponse(null);
      setError(err?.message || "Falha ao enviar texto para o backend.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleClick}
        className="rounded-md border px-4 py-2 text-sm"
      >
        {listening ? "🎤 Parar de ouvir" : "🎤 Comecar a ouvir"}
      </button>

      <p className="text-sm text-muted-foreground">
        Voce disse: {transcript || "..."}
      </p>

      <button
        type="button"
        onClick={handleSendToBackend}
        disabled={sending || !transcript.trim()}
        className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
      >
        {sending ? "Enviando..." : "Enviar texto para teste no backend"}
      </button>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      {showInlineApiResponse && apiResponse ? (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">Sheila respondeu:</p>
          <p className="mt-1">{apiResponse.message || apiResponse.error || "Sem resposta."}</p>
          {Array.isArray(apiResponse.slots) && apiResponse.slots.length > 0 ? (
            <p className="mt-2 text-muted-foreground">
              Horarios encontrados: {apiResponse.slots.join(", ")}
            </p>
          ) : null}
          {Array.isArray(apiResponse.servicesDetected) && apiResponse.servicesDetected.length > 0 ? (
            <p className="mt-2 text-muted-foreground">
              Servicos identificados: {apiResponse.servicesDetected.map((service) => service.name).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
