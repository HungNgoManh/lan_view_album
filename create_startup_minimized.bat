@echo off
echo Creating shortcut to LAN View Album server (minimized) in startup folder...

set SCRIPT="%TEMP%\create_shortcut.vbs"
echo Set oWS = WScript.CreateObject("WScript.Shell") > %SCRIPT%
echo sLinkFile = "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LAN View Album.lnk" >> %SCRIPT%
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> %SCRIPT%
echo oLink.TargetPath = "E:\lan_view_album\start_server_minimized.bat" >> %SCRIPT%
echo oLink.WorkingDirectory = "E:\lan_view_album" >> %SCRIPT%
echo oLink.Description = "Start LAN View Album server (minimized)" >> %SCRIPT%
echo oLink.WindowStyle = 7 >> %SCRIPT%
echo oLink.Save >> %SCRIPT%
cscript /nologo %SCRIPT%
del %SCRIPT%

echo Shortcut created successfully!
echo The server will now start automatically in a minimized window when you log in to Windows.
pause 