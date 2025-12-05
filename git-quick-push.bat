@echo off
setlocal

REM Usage:
REM   git-quick-push.bat
REM   git-quick-push.bat Your commit message here

set "MSG=%*"
if "%MSG%"=="" set "MSG=latest updates"

echo Staging changes...
git add -A
if errorlevel 1 (
  echo ERROR: Failed to stage changes!
  pause
  exit /b 1
)

echo Committing ("%MSG%")...
git commit -m "%MSG%"
if errorlevel 1 (
  echo Nothing to commit or commit skipped; continuing.
)

echo.
echo Detecting current branch...
for /f "tokens=*" %%i in ('git branch --show-current') do set "CURRENT_BRANCH=%%i"
if "%CURRENT_BRANCH%"=="" (
  echo WARNING: Could not detect branch
  set "CURRENT_BRANCH=unknown"
)

echo Current branch: %CURRENT_BRANCH%

REM Push to main branch
set "BRANCH=main"

REM If not on main, switch to main first
if /i not "%CURRENT_BRANCH%"=="main" (
  echo.
  echo Switching to main branch...
  git checkout main
  if errorlevel 1 (
    echo ERROR: Failed to switch to main branch!
    pause
    exit /b 1
  )
)

echo.
echo Pushing to origin %BRANCH%...
git push -u origin %BRANCH%
if errorlevel 1 (
  echo.
  echo ERROR: Push failed! Check your connection and permissions.
  pause
  exit /b 1
)

echo.
echo Successfully pushed to origin %BRANCH%!
pause

endlocal

