@echo off
SET PATH=d:\game\research-stage0\tools\node-v22.14.0-win-x64;%PATH%
cd /d "%~dp0"
echo Starting Idle Zoo 3D - Sanctuary & Conservation Preview on http://localhost:5175 ...
npm.cmd run dev
