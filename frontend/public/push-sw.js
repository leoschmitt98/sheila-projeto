self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.titulo || payload.title || "Nova notificacao";
  const body = payload.mensagem || payload.body || "Voce recebeu uma nova notificacao.";
  const url = payload.url || "/admin";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: {
        url,
        referenciaTipo: payload.referenciaTipo || null,
        referenciaId: payload.referenciaId || null,
        empresaId: payload.empresaId || null,
      },
      tag: payload.referenciaTipo && payload.referenciaId
        ? `${payload.referenciaTipo}-${payload.referenciaId}`
        : "sheila-admin-notification",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/admin";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url.includes("/admin")) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
