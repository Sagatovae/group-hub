# Уведомления приложения

Пользователь включает подписку кнопкой с колокольчиком в верхней панели. Запрос разрешения появляется только после нажатия «Включить уведомления». На iPhone нужна установленная на экран «Домой» PWA и iOS 16.4 или новее. На каждом устройстве подписка включается отдельно.

Новые строки `materials` создают задания для всех действующих подписок: объявления, материалы предметов, блоки с файлами и картинками. Правки существующих блоков не вызывают повторный push; Telegram продолжает синхронизировать их. Создание пустого предмета или раздела уведомления не отправляет. Старые материалы не рассылаются при подписке.

При нажатии на уведомление открывается соответствующий предмет или объявления. Если приложение было закрыто, его откроет браузер. Доставка зависит от сети, настроек системы и push-сервиса браузера. Расписание раз в минуту обрабатывает до 20 доставок за запуск; очередь увеличивает задержку при большом числе подписчиков.

## Развёртывание

1. После миграций Telegram применить `migrations/20261019_all_material_notifications.sql`.
2. Опубликовать `push-notifications` из `functions/push-notifications/index.ts` с `verify_jwt = false` и обновить `telegram-publisher`.
3. Применить `setup/push_schedule.sql`. Используется существующий секрет `telegram_dispatch_secret` из Vault; он должен совпадать с `TELEGRAM_DISPATCH_SECRET` в Edge Function Secrets.
4. Опубликовать фронтенд. Workbox импортирует `public/push-events.js`.

Пара VAPID генерируется сервером и хранится в закрытой таблице `push_config`. Публичный GET возвращает только публичный ключ. Закрытый ключ и подписки недоступны anon/authenticated. Не удаляйте и не меняйте ключи при обычном деплое — старые подписки перестанут получать сообщения.

Публичная функция принимает подписки только с разрешённых origin. При смене домена обновите список `origins` в функции. Пользователям придётся включить подписку на новом домене заново. Эндпоинты отправки ограничены известными push-службами браузеров. Вызов рассылки защищён отдельным серверным секретом.

Истёкшие подписки удаляются при ответах 404/410. Сбои повторяются до 8 раз; записи доставок старше 7 дней очищаются. Возможны повторы при сетевом разрыве после приёма push-сервисом: тег материала позволяет браузеру заменить уведомление вместо создания одинаковых карточек.

Для остановки планировщика:

```sql
select cron.unschedule('push-notifications');
```

Тесты, пробные уведомления и тестовые публикации автоматически не запускаются.

## First launch and notification inbox

Installed app windows offer to enable push on the first launch after this update.
The system permission request runs only from the Enable button (browser requirement).
Choosing Later remembers the choice on that device; push can still be enabled from
its bell. Existing subscriptions do not need to be recreated.

The bell lists the latest 40 published materials and announcements, regardless of
whether this device has push enabled. An item opens and highlights its material.
Unread badges count all unread materials per subject and section. A block becomes
read after it is visible in the active window for 1.2 seconds. Opening the bell or
a subject does not mark offscreen blocks as read. The inbox also has Mark all read.
Own publications are marked read immediately. Reading state is saved in this
browser's localStorage, scoped to the database URL, and shared between tabs on the
same origin. It does not sync between devices and resets if browser data is cleared.

While visible, the app reloads data every minute, on returning to the window, and
when its service worker receives a push. Background reloads skip active edits and
do not replace in-progress changes. These frontend additions do not change the
server push subscription or dispatch schema.
