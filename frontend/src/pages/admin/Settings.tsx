import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPut } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";

type EmpresaApi = {
  Id: number;
  Nome: string;
  Slug: string;
  MensagemBoasVindas: string;
  OpcoesIniciaisSheila?: string[] | null;
  WhatsappPrestador?: string | null;
  NomeProprietario?: string | null;
  Endereco?: string | null;
};

type EmpresaUpdatePayload = {
  Nome: string;
  MensagemBoasVindas: string;
  OpcoesIniciaisSheila: string[];
  WhatsappPrestador?: string | null;
  NomeProprietario?: string | null;
  Endereco?: string | null;
};

const CHAT_START_OPTIONS = [
  { id: "agendar", label: "Agendar serviço" },
  { id: "orcamento", label: "Solicitar orçamento" },
  { id: "servicos", label: "Ver serviços" },
  { id: "horarios", label: "Horários disponíveis" },
  { id: "cancelar", label: "Cancelar agendamento" },
  { id: "ajuda", label: "Falar com atendente" },
] as const;

const DEFAULT_CHAT_START_OPTIONS = CHAT_START_OPTIONS.map((option) => option.id);

export function Settings() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);

  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [chatStartOptions, setChatStartOptions] = useState<string[]>(DEFAULT_CHAT_START_OPTIONS);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 🔹 CARREGAR DO BANCO
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);

        const empresa = await apiGet<EmpresaApi>(`/api/empresas/${encodeURIComponent(slug)}`);
        if (!alive) return;

        setBusinessName(empresa.Nome || "");
        setWelcomeMessage(empresa.MensagemBoasVindas || "");
        setChatStartOptions(
          Array.isArray(empresa.OpcoesIniciaisSheila) && empresa.OpcoesIniciaisSheila.length > 0
            ? empresa.OpcoesIniciaisSheila
            : DEFAULT_CHAT_START_OPTIONS
        );
        setPhone((empresa.WhatsappPrestador || "").replace(/\D/g, ""));
        setOwnerName(empresa.NomeProprietario || "");
        setAddress(empresa.Endereco || "");
      } catch {
        toast.error("Não foi possível carregar as configurações da empresa.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [slug]);

  // 🔹 SALVAR NO BANCO
  const handleSave = async () => {
    try {
      setSaving(true);

      const payload: EmpresaUpdatePayload = {
        Nome: businessName.trim(),
        MensagemBoasVindas: welcomeMessage.trim(),
        OpcoesIniciaisSheila: chatStartOptions,
        WhatsappPrestador: phone ? phone.replace(/\D/g, "") : null,
        NomeProprietario: ownerName.trim() || null,
        Endereco: address.trim() || null,
      };

      await apiPut(`/api/empresas/${encodeURIComponent(slug)}`, payload);

      toast.success("Configurações salvas com sucesso!");
    } catch {
      toast.error("Falha ao salvar no banco. Verifique a API.");
    } finally {
      setSaving(false);
    }
  };

  const toggleChatStartOption = (optionId: string, checked: boolean) => {
    setChatStartOptions((prev) => {
      if (checked) return [...new Set([...prev, optionId])];
      return prev.filter((id) => id !== optionId);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Configurações</h1>
        <p className="text-muted-foreground mt-1">Configure as informações da sua empresa</p>
        <p className="text-xs text-muted-foreground mt-1">
          Empresa atual: <b className="text-foreground">{slug}</b>
        </p>
      </div>

      <div className="glass-card p-6 max-w-2xl space-y-6">
        <div>
          <Label>Nome da Empresa</Label>
          <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} disabled={loading || saving} />
        </div>

        <div>
          <Label>Mensagem de Boas-vindas da Sheila</Label>
          <Textarea value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} rows={3} disabled={loading || saving} />
        </div>

        <div className="space-y-3">
          <Label>Opções iniciais do chat</Label>
          <p className="text-xs text-muted-foreground">Escolha quais atalhos aparecem no início da Sheila.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CHAT_START_OPTIONS.map((option) => {
              const checked = chatStartOptions.includes(option.id);

              return (
                <label key={option.id} className="flex items-center gap-3 rounded-md border border-border/60 p-3 cursor-pointer">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => toggleChatStartOption(option.id, value === true)}
                    disabled={loading || saving}
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <Label>WhatsApp do Prestador</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} disabled={loading || saving} />
        </div>

        <div>
          <Label>Nome do Proprietário</Label>
          <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} disabled={loading || saving} />
        </div>

        <div>
          <Label>Endereço</Label>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} disabled={loading || saving} />
        </div>

        <Button onClick={handleSave} disabled={loading || saving || chatStartOptions.length === 0}>
          <Save size={18} className="mr-2" />
          {saving ? "Salvando..." : "Salvar Configurações"}
        </Button>

        {chatStartOptions.length === 0 && (
          <p className="text-xs text-destructive">Selecione pelo menos uma opção inicial para a Sheila.</p>
        )}
      </div>
    </div>
  );
}
