# Как начать работать с ИИ

Интерактивный учебный курс Банка Синара. Продакшен доступен по адресу
<http://137.74.169.62>.

## Локальный запуск

Требуется Node.js 22 или новее.

```bash
npm ci
npm run dev
```

## Проверка и сборка

```bash
npx tsc --noEmit
npm run build
```

## Развёртывание на сервере

Репозиторий клонируется в `/home/debian/interactive-presentation`. Образ
собирается из этой директории, после чего контейнер перезапускается:

```bash
git pull --ff-only origin main
sudo docker build -t interactive-presentation-course:latest .
sudo docker rm -f interactive-presentation || true
sudo docker run -d \
  --name interactive-presentation \
  --restart unless-stopped \
  -p 8080:3000 \
  interactive-presentation-course:latest

sudo docker rm -f presentation-proxy || true
sudo docker run -d \
  --name presentation-proxy \
  --restart unless-stopped \
  --network host \
  -v /home/debian/interactive-presentation/deploy/nginx.conf:/etc/nginx/nginx.conf:ro \
  nginx:alpine
```

В репозитории хранятся только исходники и используемые медиа. Зависимости,
кеши и каталог готовой сборки создаются заново при развёртывании.
