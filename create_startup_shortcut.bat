@echo off
echo Creating shortcut to LAN View Album server in startup folder...

set SCRIPT="%TEMP%\create_shortcut.vbs"
echo Set oWS = WScript.CreateObject("WScript.Shell") > %SCRIPT%
echo sLinkFile = "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LAN View Album.lnk" >> %SCRIPT%
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> %SCRIPT%
echo oLink.TargetPath = "E:\lan_view_album\start_server.bat" >> %SCRIPT%
echo oLink.WorkingDirectory = "E:\lan_view_album" >> %SCRIPT%
echo oLink.Description = "Start LAN View Album server" >> %SCRIPT%
echo oLink.Save >> %SCRIPT%
cscript /nologo %SCRIPT%
del %SCRIPT%

echo Shortcut created successfully!
echo The server will now start automatically when you log in to Windows.
pause 