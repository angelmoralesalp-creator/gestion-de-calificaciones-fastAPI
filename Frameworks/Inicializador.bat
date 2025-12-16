@echo off
title Inicializador del proyecto
python --version >nul 2>&1
if errorlevel 1 (
    echo Python no está instalado. Por favor, instale Python para continuar.
    pause
    exit /b 1
)
cd proyecto/backend
if errorlevel 1 echo Error cambiando al directorio backend && pause
echo Cambiando al directorio backend...
if exist .venv rd /s .venv
echo Eliminando entorno virtual existente...
python -m venv .venv & ".venv\Scripts\activate"
if errorlevel 1 echo Error creando o activando entorno virtual && pause
echo Creando y activando entorno virtual...
pip install -r "./requirements.txt"
if errorlevel 1 echo Error instalando dependencias && pause
echo Instalando dependencias...
python main.py
if errorlevel 1 pause
