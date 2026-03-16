import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildEmpresaPath } from "@/lib/getEmpresaSlug";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AdminNotification = {
  Id: number;
  EmpresaId: number;
  ProfissionalId: number | null;
  Tipo: string;
  Titulo: string;
  Mensagem: string;
  ReferenciaTipo: string | null;
  ReferenciaId: number | null;
  LidaEm: string | null;
  CriadaEm: string | null;
};

type NotificationsResponse = {
  ok: true;
  notificacoes: AdminNotification[];
  unreadCount: number;
};

type MarkAsReadResponse = {
  ok: true;
  notificacao: AdminNotification | null;
};

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
const NOTIFICATIONS_POLL_INTERVAL_MS = 30000;

function formatNotificationDate(value?: string | null) {
  if (!value) return "";
  const [datePart, timePart = ""] = String(value).split(" ");
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}${timePart ? ` ${timePart.slice(0, 5)}` : ""}`;
}

export function AdminNotifications({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const sessionKey = useMemo(() => `adminToken:${slug}`, [slug]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingId, setMarkingId] = useState<number | null>(null);
  const locallyReadIdsRef = useRef<number[]>([]);
  const requestInFlightRef = useRef(false);

  const fetchNotifications = useCallback(
    async ({
      silent = false,
      suppressError = false,
      force = false,
    }: {
      silent?: boolean;
      suppressError?: boolean;
      force?: boolean;
    } = {}) => {
      const token = sessionStorage.getItem(sessionKey);
      if (!token) {
        setNotifications([]);
        setUnreadCount(0);
        return;
      }

      if (requestInFlightRef.current && !force) {
        return;
      }

      requestInFlightRef.current = true;

      try {
        if (!silent) setLoading(true);
        setError("");

        const data = await apiGet<NotificationsResponse>("/api/admin/notificacoes?limit=20", {
          headers: { Authorization: `Bearer ${token}` },
        } as RequestInit);

        const incoming = Array.isArray(data.notificacoes) ? data.notificacoes : [];
        const pendingReadIds = new Set(locallyReadIdsRef.current);

        setNotifications((prev) => {
          const prevMap = new Map(prev.map((item) => [item.Id, item]));
          return incoming.map((item) => {
            if (!item.LidaEm && pendingReadIds.has(item.Id)) {
              const previous = prevMap.get(item.Id);
              return {
                ...item,
                LidaEm: previous?.LidaEm || item.CriadaEm,
              };
            }
            return item;
          });
        });

        setUnreadCount(
          Math.max(
            0,
            Number(data.unreadCount || 0) -
              incoming.filter((item) => !item.LidaEm && pendingReadIds.has(item.Id)).length
          )
        );

        locallyReadIdsRef.current = locallyReadIdsRef.current.filter((id) => {
          const serverItem = incoming.find((item) => item.Id === id);
          return Boolean(serverItem && !serverItem.LidaEm);
        });
      } catch (err: any) {
        if (!suppressError) {
          setError(err?.message || "Não foi possível carregar as notificações.");
        }
      } finally {
        requestInFlightRef.current = false;
        if (!silent) setLoading(false);
      }
    },
    [sessionKey]
  );

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      fetchNotifications({ silent: true, suppressError: true });
    }, NOTIFICATIONS_POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchNotifications({ silent: true, suppressError: true });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchNotifications]);

  async function handleMarkAsRead(notificationId: number) {
    const token = sessionStorage.getItem(sessionKey);
    if (!token) return;

    try {
      setMarkingId(notificationId);
      setError("");

      const res = await fetch(`${API_BASE}/api/admin/notificacoes/${notificationId}/lida`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Falha ao marcar notificação como lida.");
      }

      const data = (await res.json()) as MarkAsReadResponse;
      const updated = data.notificacao;
      if (!updated) return;

      if (!locallyReadIdsRef.current.includes(notificationId)) {
        locallyReadIdsRef.current = [...locallyReadIdsRef.current, notificationId];
      }

      setNotifications((prev) =>
        prev.map((item) => (item.Id === notificationId ? updated : item))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err: any) {
      setError(err?.message || "Falha ao marcar notificação como lida.");
    } finally {
      setMarkingId(null);
    }
  }

  function handleOpenAppointment(notification: AdminNotification) {
    if (notification.ReferenciaTipo !== "agendamento" || !notification.ReferenciaId) return;

    const target = buildEmpresaPath(
      `/admin/agendamentos?agendamento=${encodeURIComponent(String(notification.ReferenciaId))}`,
      slug
    );

    setOpen(false);
    navigate(target);
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          fetchNotifications({ silent: true, force: true });
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="relative shrink-0"
          aria-label="Abrir notificações"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[22rem] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">Notificações</DropdownMenuLabel>
          <span className="text-xs text-muted-foreground">{unreadCount} não lida(s)</span>
        </div>
        <DropdownMenuSeparator />

        <div className="max-h-96 overflow-y-auto">
          <div className="p-2">
            {loading && (
              <p className="px-2 py-6 text-sm text-muted-foreground">
                Carregando notificações...
              </p>
            )}

            {!loading && error && (
              <p className="px-2 py-6 text-sm text-destructive">
                {error}
              </p>
            )}

            {!loading && !error && notifications.length === 0 && (
              <p className="px-2 py-6 text-sm text-muted-foreground">
                Nenhuma notificação no momento.
              </p>
            )}

            {!loading && !error && notifications.length > 0 && (
              <div className="space-y-2">
                {notifications.map((item) => {
                  const isRead = Boolean(item.LidaEm);
                  const canOpenAppointment =
                    item.ReferenciaTipo === "agendamento" &&
                    Number.isFinite(item.ReferenciaId) &&
                    Number(item.ReferenciaId) > 0;

                  return (
                    <div
                      key={item.Id}
                      className={
                        isRead
                          ? "rounded-lg border border-border/60 bg-background p-3"
                          : "rounded-lg border border-primary/30 bg-primary/5 p-3"
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.Titulo}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatNotificationDate(item.CriadaEm)}
                          </p>
                        </div>
                        <span
                          className={
                            isRead
                              ? "mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-muted"
                              : "mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
                          }
                        />
                      </div>

                      <p className="mt-2 text-sm text-muted-foreground">
                        {item.Mensagem}
                      </p>

                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        {canOpenAppointment && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenAppointment(item)}
                          >
                            Abrir agendamento
                          </Button>
                        )}

                        {isRead ? (
                          <span className="self-center text-xs text-muted-foreground">Lida</span>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleMarkAsRead(item.Id)}
                            disabled={markingId === item.Id}
                          >
                            <CheckCheck className="h-4 w-4" />
                            {markingId === item.Id ? "Marcando..." : "Marcar como lida"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
