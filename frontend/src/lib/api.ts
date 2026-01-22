// ==============================
// Configuração base da API
// ==============================
const API_URL = import.meta.env.VITE_API_BASE;

// ==============================
// Tipos genéricos já existentes
// (mantive tudo compatível)
// ==============================
export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(`${API_URL}${url}`);

  if (!res.ok) {
    throw new Error("Erro ao buscar dados da API");
  }

  return res.json();
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error("Erro ao enviar dados para a API");
  }

  return res.json();
}

export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${url}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error("Erro ao atualizar dados da API");
  }

  return res.json();
}

// ==============================
// Chat inteligente (Sheila)
// ==============================

export type ChatResponse =
  | {
      ok: true;
      type: "text";
      content: string;
    }
  | {
      ok: true;
      type: "action";
      action: string;
      content: string;
    };

export async function sendChatMessage(
  empresaSlug: string,
  message: string
): Promise<ChatResponse> {
  const res = await fetch(
    `${API_URL}/api/empresas/${empresaSlug}/chat/cliente`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    }
  );

  if (!res.ok) {
    throw new Error("Erro ao enviar mensagem para o chat");
  }

  return res.json();
}
