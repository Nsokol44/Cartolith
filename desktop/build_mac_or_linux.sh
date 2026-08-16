#!/usr/bin/env bash
# Build a double-click Cartolith app on macOS or Linux.
# Run from the PROJECT ROOT: bash desktop/build_mac_or_linux.sh
set -e

echo "==> Building frontend"
cd frontend
npm ci
npm run build
cd ..

echo "==> Setting up Python build environment"
python3 -m venv .build-venv
source .build-venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt -r desktop/requirements-desktop.txt

echo "==> Running PyInstaller"
cd desktop
pyinstaller cartolith.spec --noconfirm
cd ..

echo ""
echo "Done. Output is in desktop/dist/Cartolith"
if [ "$(uname)" = "Darwin" ]; then
  echo "macOS app bundle: desktop/dist/Cartolith.app"
  echo "Zip it for distribution: cd desktop/dist && zip -r Cartolith-mac.zip Cartolith.app"
fi
