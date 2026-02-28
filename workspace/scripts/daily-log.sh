#!/bin/bash
TODAY=$(date +%Y-%m-%d)
FILE="/opt/tele-codex-bot/workspace/memory/${TODAY}.md"
if [ ! -f "$FILE" ]; then
    mkdir -p /opt/tele-codex-bot/workspace/memory
    echo "# ${TODAY} - Daily Log" > "$FILE"
    echo "" >> "$FILE"
    echo "## Tasks" >> "$FILE"
    echo "" >> "$FILE"
    echo "## Notes" >> "$FILE"
fi
