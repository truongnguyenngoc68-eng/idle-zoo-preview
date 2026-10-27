@echo off
SET PATH=d:\game\research-stage0\tools\node-v22.14.0-win-x64;%PATH%
cd /d "%~dp0"
echo Starting KayKit 3D Combat Preview on http://localhost:5174 ...
npm.cmd run dev
