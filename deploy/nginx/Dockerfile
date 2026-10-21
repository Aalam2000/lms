# nginx прода — конфиг внутри образа, как код бэкенда и фронта.
# На проде работает ровно prod.conf из git этого коммита: правка конфига
# = новый образ, docker compose up -d --build (scripts/deploy-prod.sh) сам
# пересоздаёт nginx; конфиг не менялся — образ тот же, nginx не трогается.
# Раньше prod.conf подключался файлом с диска, и после git reset контейнер
# продолжал видеть старый файл — правки до прода не доходили.
FROM nginx:alpine
COPY prod.conf /etc/nginx/conf.d/default.conf
