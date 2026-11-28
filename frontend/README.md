# Кабинет оператора IRIS

Кабинет использует React, TypeScript, Vite, Tailwind, Inter, React Router, TanStack Query и TanStack Table. Общие компоненты и токены находятся в `src/components` и `src/styles/index.css`. Модуль CRM включает таблицу клиентов и вкладки по счетам. Модуль операций включает сводки, транскрипции, очередь и статусы сотрудников.

Запустите FastAPI и Vite из инструкций основного README. Для разработки команда npm run dev запускает Vite с горячим обновлением. Vite проксирует `/api` на `http://127.0.0.1:8000`. Для другого backend задайте `IRIS_API_TARGET` при старте frontend. Для развёртывания соберите `dist` через `npm run build`, направьте `/api` на FastAPI на том же origin и настройте возврат `index.html` для маршрутов React Router. SSE требует передачи событий без буферизации. [Запуск IRIS](../README.md)

## Проверка в браузере

```powershell
npm exec playwright install chromium
npm run test:e2e
```

Если установлен Microsoft Edge, можно задать `IRIS_BROWSER_CHANNEL=msedge`. Playwright использует `http://127.0.0.1:5173`, адрес можно переопределить через `IRIS_E2E_URL`. Сценарии `e2e/mutations.spec.ts` включаются через `IRIS_E2E_WRITE=1`. Для них запустите API с новой SQLite через `DATABASE_PATH`, чтобы сценарии начинались с исходных учебных статусов. Скриншоты проверенных страниц при 1920×1080, 1440×900, 1280×800 и 1024×768 записываются в `test-results/screenshots/`.

Для полного прогона запустите Backend с `IRIS_DEMO=1` на новой учебной SQLite. Задайте локальное тестовое значение `IRIS_VOICE_TOKEN` только в этом экземпляре Backend и передайте то же значение Playwright через `IRIS_E2E_VOICE_TOKEN`. Включите `IRIS_E2E_WRITE=1`. Сценарий `operator-live.spec.ts` отправляет события напрямую в FastAPI и проверяет назначение, SSE, CRM и команды управления звонком. Для повторного полного прогона используйте новый файл SQLite.
