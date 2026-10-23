#!/usr/bin/env bash
# Отчёт о нагрузке сервера понятным текстом: процессор, память, swap, диск
# и вывод — хватает ли сервера или его пора увеличивать.
# Данные — из истории sysstat (один замер = среднее за 10 минут).
# Скрипт только читает, на сервере ничего не меняет.
#
#   bash /var/www/lms/scripts/load-report.sh       # за последние сутки
#   bash /var/www/lms/scripts/load-report.sh 7     # за последние 7 суток
set -euo pipefail

DAYS="${1:-1}"
if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "$DAYS" -lt 1 ] || [ "$DAYS" -gt 28 ]; then
    echo "Использование: bash $0 [число суток от 1 до 28, по умолчанию 1]" >&2
    exit 2
fi

# Пороги (в процентах)
CPU_HIGH=80      # замер считается «тяжёлым» для процессора
MEM_WARN=70      # память: стоит понаблюдать
MEM_HIGH=85      # память: пора увеличивать
SWAP_HIGH=20     # swap занят заметно — памяти не хватает
DISK_WARN=70     # диск: стоит понаблюдать
DISK_HIGH=80     # диск: пора увеличивать или чистить

SA_DIR="${SA_DIR:-/var/log/sysstat}"
REPORT_TZ="Asia/Baku"

command -v sadf >/dev/null || { echo "Не найден sadf (пакет sysstat) — отчёт построить не из чего." >&2; exit 1; }
shopt -s nullglob
FILES=("$SA_DIR"/sa[0-9][0-9])
[ "${#FILES[@]}" -gt 0 ] || { echo "В $SA_DIR нет истории sysstat." >&2; exit 1; }

NOW=$(date +%s)
SINCE=$((NOW - DAYS * 86400))
CORES=$(nproc)
MEM_TOTAL_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)

fmt_time() { TZ="$REPORT_TZ" date -d "@$1" '+%d.%m %H:%M'; }

# series <опция sar> <выражение awk> -> строки «время значение» за период.
# В выражении v("имя") — значение колонки с таким именем из вывода sadf.
series() {
    local f
    for f in "${FILES[@]}"; do
        LC_ALL=C sadf -d -U "$f" -- "$1" 2>/dev/null || true
    done | LC_ALL=C awk -F';' -v since="$SINCE" -v total="$MEM_TOTAL_KB" '
        function v(n) { return $(col[n]) }
        /^#/ { delete col; for (i = 1; i <= NF; i++) col[$i] = i; next }
        NF < 5 || $2 < 0 || $3 < since { next }
        { print $3, ('"$2"') }'
}

# summ <порог> -> «пик время_пика среднее замеров замеров_выше_порога первый_замер»
summ() {
    LC_ALL=C awk -v th="$1" '
        { if (NR == 1 || $2 > m) { m = $2; t = $1 }
          if (NR == 1 || $1 < first) first = $1
          s += $2; n++; if ($2 >= th) over++ }
        END { if (n) printf "%.1f %d %.1f %d %d %d\n", m, t, s / n, n, over, first }'
}

read -r CPU_MAX CPU_T CPU_AVG CPU_N CPU_OVER FIRST < <(series -u '100 - v("%idle")' | summ "$CPU_HIGH") || true
read -r MEM_MAX MEM_T MEM_AVG _ _ _ < <(series -r '("kbavail" in col) ? 100 * (total - v("kbavail")) / total : v("%memused")' | summ "$MEM_HIGH") || true
read -r SWP_MAX SWP_T _ _ _ _ < <(series -S 'v("%swpused")' | summ "$SWAP_HIGH") || true
read -r LD_MAX LD_T LD_AVG _ _ _ < <(series -q 'v("ldavg-5")' | summ "$CORES") || true

if [ -z "${CPU_N:-}" ]; then
    echo "За последние $DAYS сут. в истории sysstat нет замеров." >&2
    exit 1
fi

r() { printf '%.0f' "$1"; }   # округление до целого
DISK_PCT=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
DISK_TXT=$(df -Ph / | awk 'NR==2 {print $3 " из " $2 ", свободно " $4}')

echo "ОТЧЁТ О НАГРУЗКЕ СЕРВЕРА $(hostname)"
echo "Период: $(fmt_time "$FIRST") — $(fmt_time "$NOW") (время Баку), замеров: $CPU_N"
echo "Один замер — среднее за 10 минут."
echo
echo "Процессор (ядер: $CORES)"
echo "  пик:      $(r "$CPU_MAX") %  ($(fmt_time "$CPU_T"))"
echo "  среднее:  $(r "$CPU_AVG") %"
echo "  замеров выше $CPU_HIGH %: $CPU_OVER"
if [ -n "${LD_MAX:-}" ]; then
    echo "  очередь задач (load average): пик $LD_MAX ($(fmt_time "$LD_T")), норма — до $CORES"
fi
echo
echo "Память (всего $((MEM_TOTAL_KB / 1024)) МБ)"
echo "  пик:      $(r "$MEM_MAX") %  ($(fmt_time "$MEM_T"))"
echo "  среднее:  $(r "$MEM_AVG") %"
if [ -n "${SWP_MAX:-}" ]; then
    echo "  swap, пик: $(r "$SWP_MAX") %"
fi
echo
echo "Диск /"
echo "  занято:   $DISK_PCT %  ($DISK_TXT)"
echo

if command -v docker >/dev/null && docker ps -q >/dev/null 2>&1; then
    echo "Контейнеры сейчас"
    docker stats --no-stream --format '  {{.Name}}: процессор {{.CPUPerc}}, память {{.MemUsage}}' 2>/dev/null || true
    echo
fi

PROBLEMS=()
NOTES=()
ge() { LC_ALL=C awk -v a="$1" -v b="$2" 'BEGIN { exit !(a >= b) }'; }

if [ "$CPU_OVER" -ge $((3 * DAYS)) ]; then
    PROBLEMS+=("процессор: $CPU_OVER замеров (около $((CPU_OVER * 10)) минут) выше $CPU_HIGH % — нужно больше ядер")
elif ge "$CPU_MAX" "$CPU_HIGH"; then
    NOTES+=("процессор: были короткие пики до $(r "$CPU_MAX") %")
fi
if [ -n "${LD_MAX:-}" ] && ge "$LD_MAX" "$((CORES * 2))"; then
    NOTES+=("процессор: задачи стояли в очереди (load average до $LD_MAX при $CORES ядрах)")
fi
if ge "$MEM_MAX" "$MEM_HIGH"; then
    PROBLEMS+=("память: пик $(r "$MEM_MAX") % — нужно больше памяти")
elif ge "$MEM_MAX" "$MEM_WARN"; then
    NOTES+=("память: пик $(r "$MEM_MAX") %")
fi
if [ -n "${SWP_MAX:-}" ] && ge "$SWP_MAX" "$SWAP_HIGH"; then
    PROBLEMS+=("swap занят до $(r "$SWP_MAX") % — памяти не хватает")
fi
if [ "$DISK_PCT" -ge "$DISK_HIGH" ]; then
    PROBLEMS+=("диск занят на $DISK_PCT % — нужно чистить или увеличивать")
elif [ "$DISK_PCT" -ge "$DISK_WARN" ]; then
    NOTES+=("диск занят на $DISK_PCT %")
fi

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
    echo "ИТОГ: ПОРА УВЕЛИЧИВАТЬ СЕРВЕР"
    printf '  - %s\n' "${PROBLEMS[@]}"
    [ "${#NOTES[@]}" -gt 0 ] && printf '  - %s\n' "${NOTES[@]}"
elif [ "${#NOTES[@]}" -gt 0 ]; then
    echo "ИТОГ: запас пока есть, но стоит понаблюдать"
    printf '  - %s\n' "${NOTES[@]}"
else
    echo "ИТОГ: запас есть, увеличивать сервер не нужно."
fi
