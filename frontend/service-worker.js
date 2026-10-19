self.addEventListener('push', event => {
    let payload;
    try {
        payload = event.data ? event.data.json() : {};
    } catch (error) {
        console.error('Payload Web Push DHS tidak valid:', error);
        return;
    }

    const title = payload.title || 'Notifikasi DHS';
    const taskId = String(payload.taskId || 'general');
    const targetUrl = resolveDataCenterUrl(payload.url);

    event.waitUntil(self.registration.showNotification(title, {
        body: payload.body || 'Ada pembaruan pada antrean produksi.',
        tag: payload.tag || `dhs-qc-${taskId}`,
        renotify: payload.renotify !== false,
        requireInteraction: true,
        data: { url: targetUrl.href }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = resolveDataCenterUrl(event.notification.data?.url);

    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
        const existingClient = clients.find(client => new URL(client.url).pathname === targetUrl.pathname);
        if (existingClient) {
            if (existingClient.url !== targetUrl.href && 'navigate' in existingClient) {
                await existingClient.navigate(targetUrl.href);
            }
            return existingClient.focus();
        }
        return self.clients.openWindow(targetUrl.href);
    }));
});

function resolveDataCenterUrl(url) {
    const targetUrl = new URL(url || 'data-center.html', self.registration.scope);
    return targetUrl.origin === self.location.origin
        ? targetUrl
        : new URL('data-center.html', self.registration.scope);
}
