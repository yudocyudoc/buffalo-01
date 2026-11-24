#!/bin/sh
set -eu

# Check the security context after setpriv execs a nonprivileged shell and
# immediately before that same process execs bwrap. Only fixed probe arguments
# reach this launcher. A failed check must never start bwrap.
exec /usr/bin/setpriv --inh-caps=-all --ambient-caps=-all --no-new-privs -- /bin/sh -eu -c '
  reject() { printf "%s\n" R1_BWRAP_LAUNCH_CONTEXT_REJECTED >&2; exit 77; }
  uid_ok=0
  nnp_ok=0
  caps=0
  while read -r field first second third fourth; do
    case "$field" in
      Uid:)
        case "$first" in ""|*[!0-9]*) reject ;; esac
        [ "$first" -gt 0 ] && [ "$first" = "$second" ] &&
          [ "$first" = "$third" ] && [ "$first" = "$fourth" ] || reject
        uid_ok=1
        ;;
      CapInh:|CapPrm:|CapEff:|CapAmb:)
        case "$first" in ""|*[!0]*) reject ;; esac
        caps=$((caps + 1))
        ;;
      NoNewPrivs:)
        [ "$first" = 1 ] || reject
        nnp_ok=1
        ;;
    esac
  done < /proc/self/status
  [ "$uid_ok" = 1 ] && [ "$nnp_ok" = 1 ] && [ "$caps" = 4 ] || reject
  printf "%s\n" R1_BWRAP_LAUNCH_CONTEXT_VERIFIED
  exec /usr/bin/bwrap "$@"
' r1-bwrap "$@"
