#!/bin/bash
# ---------------------------------------------------------------------
# Install and Run Cartolith.command
#
# Double-click this file (not Cartolith.app) the first time you use
# Cartolith on a Mac.
#
# Cartolith.app isn't signed with a paid Apple Developer certificate, so
# macOS Gatekeeper blocks it the first time with a message like
# "Cartolith can't be opened because Apple cannot check it for malicious
# software" or "...is not verified." That is NOT a sign anything is
# actually wrong with the app -- it's just unsigned. This script clears
# the "quarantine" flag macOS attaches to anything downloaded from the
# internet, which is what triggers that block.
#
# After the first run, Cartolith.app can be opened normally (double-click
# it, or use Spotlight/Launchpad if you moved it to Applications).
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
echo "Cartolith is starting -- a window will open in a few seconds."
echo "You can close this window."
sleep 2
