@echo off
REM Build a double-click Cartolith.exe on Windows.
REM Run from the PROJECT ROOT: desktop\build_windows.bat
setlocal

echo ==^> Building frontend
cd frontend
call npm ci
call npm run build
cd ..

echo ==^> Setting up Python build environment
python -m venv .build-venv
call .build-venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r backend\requirements.txt -r desktop\requirements-desktop.txt

echo ==^> Running PyInstaller
cd desktop
pyinstaller cartolith.spec --noconfirm
cd ..

echo.
echo Done. Output is in desktop\dist\Cartolith\Cartolith.exe
echo Zip the whole Cartolith folder for distribution -- students need
echo every file in it next to the .exe, not just the .exe alone.
