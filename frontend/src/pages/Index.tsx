import { useEffect, useMemo, useState } from "react";
import { SheilaChat } from "@/components/chat/SheilaChat";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { buildEmpresaPath, getEmpresaSlug } from "@/lib/getEmpresaSlug";

type Empresa = {
  Id: number;
  Nome: string;
  Slug: string;
  MensagemBoasVindas: string;
  OpcoesIniciaisSheila?: string[] | null;
  WhatsappPrestador?: string | null;
  NomeProprietario?: string | null;
};

const Index = () => {
  const slug = useMemo(() => getEmpresaSlug(), []);

  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setErro(null);

        const data = await apiGet<Empresa>(`/api/empresas/${encodeURIComponent(slug)}`);

        if (!alive) return;
        setEmpresa(data);
      } catch (e: any) {
        if (!alive) return;
        setEmpresa(null);
        const msg = String(e?.message || "");
        if (msg.includes("Empresa não encontrada") || msg.includes("404")) {
          setErro("Estabelecimento não encontrado.");
        } else {
          setErro("Não foi possível carregar os dados do estabelecimento.");
        }
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [slug]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold gradient-text">
              {loading ? "Carregando..." : empresa?.Nome ?? "Estabelecimento"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Carregando atendimento..."
                : erro
                ? "Falha ao carregar dados do atendimento"
                : "Atendimento virtual com Sheila"}
            </p>
          </div>

          <Link to={buildEmpresaPath("/admin", slug)} data-cy="link-admin">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              data-cy="btn-admin"
            >
              <Settings size={18} className="mr-2" />
              Admin
            </Button>
          </Link>
        </div>
      </header>

      {/* Mensagem de erro (se ocorrer) */}
      {erro && (
        <div className="container mx-auto px-4 py-3">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {erro} (empresa: <b>{slug}</b>)
          </div>
        </div>
      )}

      {/* Chat Area */}
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4">
        <SheilaChat
          companyName={empresa?.Nome}
          welcomeMessage={empresa?.MensagemBoasVindas}
          initialOptions={empresa?.OpcoesIniciaisSheila}
          providerWhatsapp={empresa?.WhatsappPrestador}
          providerName={empresa?.NomeProprietario}
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 text-center">
        <p className="text-sm text-muted-foreground">
          Desenvolvido com ❤️ para facilitar seus agendamentos
        </p>
      </footer>
    </div>
  );
};

export default Index;
