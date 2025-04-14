@echo off
title LAN View Album Server
echo Starting LAN View Album server...
cd /d E:\lan_view_album
start /min cmd /c "title LAN View Album Server & node server.js & pause"
exit 