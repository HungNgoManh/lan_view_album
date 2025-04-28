@echo off
setlocal enabledelayedexpansion

REM Directory containing your videos (change as needed)
set "VIDEO_DIR=uploads"
REM Directory to store thumbnails
set "THUMB_DIR=thumbnails"

REM Create thumbnails directory if it doesn't exist
if not exist "%THUMB_DIR%" mkdir "%THUMB_DIR%"

REM Supported video extensions
set "EXTS=mp4 webm mov"

REM Loop through all video files
for %%E in (%EXTS%) do (
    for /r "%VIDEO_DIR%" %%F in (*.%%E) do (
        set "video=%%F"
        set "filename=%%~nxF"
        set "thumbname=%%~nxF.jpg"
        set "thumbpath=%THUMB_DIR%\!thumbname!"

        if exist "!thumbpath!" (
            echo Thumbnail exists: !thumbpath!
        ) else (
            REM Always use 3 seconds for thumbnail extraction
            set "seek=3"
            echo Generating thumbnail for !filename! at !seek!s...
            ffmpeg -y -ss !seek! -i "%%F" -vframes 1 -vf "scale=400:-1" "!thumbpath!"
        )
    )
)

echo All done!
pause 