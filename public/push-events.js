/* Loaded by the generated Workbox service worker. */
self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { /* Always show a visible notification. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'ИДБ-26-09', {
    body: payload.body || 'На сайте опубликован новый материал',
    icon: new URL('icon-192.png', self.registration.scope).href,
    badge: new URL('icon-192.png', self.registration.scope).href,
    tag: payload.tag || 'group-hub-update',
    data: { route: typeof payload.route === 'string' && /^#(home|subject\/[a-zA-Z0-9-]+)$/.test(payload.route) ? payload.route : '#home' },
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const route = event.notification.data?.route || '#home'
  const target = new URL(route, self.registration.scope).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        await client.navigate(target)
        await client.focus()
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
