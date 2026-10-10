#!/bin/bash
cd "$(dirname "$0")/dist"
(sleep 1; open "http://localhost:8000") &
echo "BLASTER ARENA запущена: http://localhost:8000"
echo "Чтобы остановить, закрой это окно."
python3 -m http.server 8000
