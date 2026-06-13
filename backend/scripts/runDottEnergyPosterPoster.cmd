@echo off
cd /d "%~dp0\.."
set NODE_TLS_REJECT_UNAUTHORIZED=0
set META_GRAPH_TOKEN=
set DOTT_ENERGY_META_USER_TOKEN=
set DOTTENERGY_META_USER_TOKEN=
set CLIENT_META_USER_TOKEN=
call .\node_modules\.bin\tsx.cmd scripts\dottEnergyDirectPoster.ts --mode=poster >> ..\exports\dottenergy-poster-task.log 2>&1
