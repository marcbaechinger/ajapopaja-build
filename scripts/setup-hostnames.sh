#!/bin/bash
# Idempotently install the friendly hostnames for the local Ajapopaja instances:
#
#   127.0.0.1  ajapopaja        -> production  (default port 8081)
#   127.0.0.1  ajapopaja.stage  -> staging     (default port 8082)
#
# The entries are written as a *managed block* in /etc/hosts (or in the file
# named by $HOSTS_FILE, which mainly exists so the unit test can point the
# script at a temporary file). Re-running the script replaces the block in
# place and never duplicates entries; `--remove` deletes the block again.
#
# Usage:
#   sudo scripts/setup-hostnames.sh            # install/update the entries
#   sudo scripts/setup-hostnames.sh --remove   # remove the managed block
#
# When writing the real /etc/hosts the script needs root (sudo).
set -euo pipefail

BEGIN_MARK="# BEGIN ajapopaja hostnames (managed - do not edit)"
END_MARK="# END ajapopaja hostnames (managed)"

HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
ACTION="install"

for arg in "$@"; do
  case "$arg" in
    --remove) ACTION="remove" ;;
    -h|--help)
      echo "Usage: $0 [--remove]"
      echo "Writes the managed ajapopaja hostname block into \$HOSTS_FILE."
      echo "(\$HOSTS_FILE defaults to /etc/hosts; use sudo for that.)"
      exit 0
      ;;
    *)
      echo "Unknown option '$arg' (supported: --remove, --help)" >&2
      exit 1
      ;;
  esac
done

if [[ "$HOSTS_FILE" == "/etc/hosts" && ! -w "$HOSTS_FILE" && "$(id -u)" -ne 0 ]]; then
  echo "ERROR: $HOSTS_FILE is not writable for user '$(id -un)'. Re-run with sudo." >&2
  exit 1
fi

# Strip the previously managed block (if any) so re-runs never duplicate lines.
if grep -qF "$BEGIN_MARK" "$HOSTS_FILE" 2>/dev/null; then
  sed -i "/$(printf '%s' "$BEGIN_MARK" | sed 's/[.[\*/^$]/\\&/g')/,/$(printf '%s' "$END_MARK" | sed 's/[.[\*/^$]/\\&/g')/d" "$HOSTS_FILE"
fi

if [[ "$ACTION" == "install" ]]; then
  # Make sure the file ends with a newline before appending the block.
  if [[ -s "$HOSTS_FILE" ]] && [[ -n "$(tail -c1 "$HOSTS_FILE")" ]]; then
    printf '\n' >> "$HOSTS_FILE"
  fi
  {
    echo "$BEGIN_MARK"
    echo "127.0.0.1  ajapopaja"
    echo "127.0.0.1  ajapopaja.stage"
    echo "$END_MARK"
  } >> "$HOSTS_FILE"
  echo "Installed hostname entries in $HOSTS_FILE:"
  echo "  127.0.0.1  ajapopaja        -> production"
  echo "  127.0.0.1  ajapopaja.stage  -> staging"
else
  echo "Removed the managed ajapopaja hostname block from $HOSTS_FILE."
fi
