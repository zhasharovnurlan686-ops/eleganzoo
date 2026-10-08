ELEGANZO.MIR — АДМИНКА + GITHUB + VERCEL

Структура проекта:
index.html
admin.html
products.json
api/admin.js
products/

ВАЖНО:
Все эти файлы должны находиться в ОДНОМ GitHub-репозитории, который подключён к Vercel.
Папка api должна находиться именно в корне проекта.

ПЕРЕМЕННЫЕ VERCEL:
1. GITHUB_TOKEN — GitHub token с правом Contents: Read and write для репозитория.
2. GITHUB_OWNER — владелец репозитория, например zhasharovnurlan686-ops
3. GITHUB_REPO — название репозитория, например Eleganzo_mir
4. GITHUB_BRANCH — main
5. ADMIN_PASSWORD — придуманный тобой пароль администратора

После изменения Environment Variables нужно сделать Redeploy в Vercel.

КАК РАБОТАЕТ:
1. /admin.html отправляет пароль на /api/admin.
2. API проверяет ADMIN_PASSWORD.
3. После входа API читает products.json из GitHub.
4. При сохранении товара API обновляет products.json через GitHub API.
5. При загрузке фото API сохраняет фото в products/ через GitHub API.
6. Vercel видит новый commit и автоматически деплоит сайт.
7. index.html читает /products.json и показывает опубликованные товары.

ПРОВЕРКА:
Открой:
https://ТВОЙ-ДОМЕН/admin.html

После добавления товара проверь GitHub:
- products.json должен измениться;
- новое фото должно появиться в products/.

Если products.json в GitHub НЕ меняется — проблема в GITHUB_TOKEN / OWNER / REPO / BRANCH или в API.
Если products.json меняется, но сайт не показывает товар — проверь, что index.html и products.json находятся в корне одного Vercel-проекта.

ФОТО:
Админка принимает JPG, PNG, WebP до 3 МБ.

ДИЗАЙН:
Текущий дизайн сайта не заменён. Исправлена только логика динамических товаров и поддержка строковых ID из админки.
