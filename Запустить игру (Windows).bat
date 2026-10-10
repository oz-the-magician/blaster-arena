@echo off
cd /d "%~dp0dist"
start "" http://localhost:8000
python -m http.server 8000
