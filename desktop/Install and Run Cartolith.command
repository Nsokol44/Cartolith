#!/bin/bash
# ---------------------------------------------------------------------
# Install and Run Cartolith.command
#
# Double-click this file (not Cartolith.app) the first time you use
# Cartolith on a Mac. It removes the "quarantine" flag macOS puts on
# apps downloaded from the internet -- without this, macOS refuses to
# open Cartolith.app and shows "Cartolith is damaged and can't be
# opened" (it isn't actually damaged; it's just unsigned).
#
# After the first run, you can launch Cartolith.app normally.
# ---------------------------------------------------------------------

# cd to the folder this script is sitting in, so it works no matter
# where the zip was unpacked to.
cd "$(dirname "$0")"

APP_NAME="Cartolith.app"

if [ ! -d "$APP_NAME" ]; then
    echo "Could not find $APP_NAME next to this script."
    echo "Make sure this file is in the same folder as Cartolith.app."
    read -p "Press Enter to close..."
    exit 1
fi

echo "Setting up Cartolith for the first time..."
xattr -cr "$APP_NAME"

echo "Launching Cartolith..."
open "$APP_NAME"

echo ""
echo "Cartolith is starting -- a browser tab will open automatically in a few seconds."
echo "You can close this window."
sleep 2
