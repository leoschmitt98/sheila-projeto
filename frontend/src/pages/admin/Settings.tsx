import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Building2, User, Phone, MapPin, Save } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

type EmpresaApi = {
  Id: number;
  Nome: string;
  Slug: string;
  MensagemBoasVindas: string;
  WhatsappPrestador?: string | null;
  NomeProprietario?: string | null;
  Endereco?: string | null;
};

type EmpresaUpdatePayload = {
  Nome: string;
  MensagemBoasVindas: string;
  WhatsappPrestador?: string | null;
  NomeProprietario?: string | null;
  Endereco?: string | null;
};

export function Settings() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => searchParams.get("empresa") || "nando", [searchParams]);

  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function apiPut<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

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

        <Button onClick={handleSave} disabled={loading || saving}>
          <Save size={18} className="mr-2" />
          {saving ? "Salvando..." : "Salvar Configurações"}
        </Button>
      </div>
    </div>
  );
}
