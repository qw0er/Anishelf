#!/usr/bin/env bash
# Interactive installer. Keep all mutations in main, after the complete script loads.
set -Eeuo pipefail
umask 077

repository=qw0er/Anishelf
source_ref=main
templates_dir=
generate_only=false
engine=
podman_rootless=false
stage_dir=
log_file=
phase='collecting configuration'

log() {
  printf '[anishelf] %s\n' "$*" >&2
  if [[ -n "$log_file" ]]; then printf '[anishelf] %s\n' "$*" >> "$log_file"; fi
}
die() { log "ERROR: $*"; exit 1; }
cleanup() { if [[ -n "$stage_dir" ]]; then rm -rf "$stage_dir"; fi; }
on_error() {
  trap - ERR
  printf '[anishelf] ERROR while %s. Existing data is preserved; inspect the output above.\n' "$phase" >&2
  if [[ -n "$log_file" ]]; then printf 'Failed while %s.\n' "$phase" >> "$log_file"; fi
  exit 1
}
trap cleanup EXIT
trap on_error ERR
trap 'exit 130' INT
trap 'exit 143' TERM

usage() {
  cat <<'HELP'
Usage: bash install.sh [--generate-only] [--ref REF] [--templates-dir DIRECTORY] [--engine docker|podman]

Configure Docker/Podman Compose or rootless Podman Quadlet interactively.
--generate-only  Write a new deployment bundle without contacting a container engine
                 or installing systemd units. No existing files are overwritten.
--ref REF        GitHub branch, tag or commit for deployment templates (default main).
                 Branch/tag names containing slashes are not supported.
--templates-dir  Use local package/deploy templates instead of GitHub (maintainers).
--engine         Explicit engine for automated generation; normally auto-detected.
--help           Show this help.

Requires Bash and curl; Compose needs Docker Compose v2 or Podman with an external
Compose provider. Quadlet needs Linux with rootless Podman, cgroup v2, Quadlet
and an active systemd user session.
HELP
}
ask() {
  local label=$1 fallback=$2
  printf '%s [%s]: ' "$label" "$fallback" >&2
  IFS= read -r answer <&3 || die 'Input ended before configuration was complete.'
  answer=${answer:-$fallback}
}
yes_no() {
  while :; do
    ask "$1 (y/n)" "$2"
    case "$answer" in y|Y|yes|YES) answer=yes; return;; n|N|no|NO) answer=no; return;; esac
    log 'Enter y or n.'
  done
}
valid_port() { [[ "$1" =~ ^[0-9]{1,5}$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
port() {
  while :; do
    ask "$1" "$2"
    if valid_port "$answer" && { [[ "$method" != quadlet && "$podman_rootless" != true ]] || ((10#$answer >= 1024)); }; then
      answer=$((10#$answer)); return
    fi
    log 'Enter a port from 1 to 65535 (1024 or higher for rootless Podman).'
  done
}
valid_path() {
  [[ "$1" == /* && ! "$1" =~ [[:cntrl:]] ]] || return 1
  case "$1" in *:*|*\'*|*\"*|*\\*|*\$*|*\`*|*%*) return 1;; esac
}
valid_ipv4() {
  local octet
  local -a octets
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r -a octets <<< "$1"
  for octet in "${octets[@]}"; do
    [[ "$octet" =~ ^(0|[1-9][0-9]{0,2})$ ]] && ((10#$octet <= 255)) || return 1
  done
}
valid_origin() {
  [[ "$1" =~ ^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]] || return 1
  local authority=${1#*://}
  [[ "$authority" != *:* ]] || valid_port "${authority##*:}"
}
need() { command -v "$1" >/dev/null 2>&1 || die "Required command is missing: $1"; }
exists() { [[ -e "$1" || -L "$1" ]]; }
fetch() {
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --connect-timeout 10 --max-time 90 --retry 2 "$1" -o "$2"
}
asset() {
  local relative=$1 destination=$2
  if [[ -n "$templates_dir" ]]; then
    cp "$templates_dir/$relative" "$destination"
  else
    fetch "https://raw.githubusercontent.com/$repository/$source_commit/package/deploy/$relative" "$destination"
  fi
  [[ -s "$destination" ]] || die "Empty deployment template: $relative"
}
# No eval, sourcing .env, or shell interpolation of user-provided configuration.
write_env() { printf "%s='%s'\n" "$1" "$2" >> "$stage_dir/bundle/.env"; }
unit_value() { printf '"%s"' "$1"; }
render_unit() {
  local name=$1 line
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$name:$line" in
      *:Image=ghcr.io/qw0er/anishelf-backend:*) line="Image=ghcr.io/qw0er/anishelf-backend:$image_tag";;
      *:Image=ghcr.io/qw0er/anishelf-web:*) line="Image=ghcr.io/qw0er/anishelf-web:$image_tag";;
      *:Environment=ANISHELF_PUBLIC_ORIGIN=*) line="Environment=ANISHELF_PUBLIC_ORIGIN=$public_origin";;
      anishelf-web.container:PublishPort=*) line="PublishPort=$bind_address:$app_port:8080";;
      anishelf-jackett.container:PublishPort=*) line="PublishPort=127.0.0.1:$jackett_port:9117";;
      anishelf-qbittorrent.container:Environment=TORRENTING_PORT=*) line="Environment=TORRENTING_PORT=$peer_port";;
      anishelf-qbittorrent.container:PublishPort=127.0.0.1:8080:8080) line="PublishPort=127.0.0.1:$qbit_port:8080";;
      anishelf-qbittorrent.container:PublishPort=6881:6881) line="PublishPort=$peer_port:$peer_port";;
      anishelf-qbittorrent.container:PublishPort=6881:6881/udp) line="PublishPort=$peer_port:$peer_port/udp";;
      *:Volume=anishelf-media.volume:/data/media:ro)
        if [[ -n "$media_path" ]]; then line="Volume=$(unit_value "$media_path:/data/media:ro$selinux_suffix")"; fi;;
      *:Volume=anishelf-media.volume:/data/media)
        if [[ -n "$media_path" ]]; then line="Volume=$(unit_value "$media_path:/data/media${selinux_suffix:+:z}")"; fi;;
    esac
    if [[ -n "$media_path" && "$name" == anishelf-qbittorrent.container ]]; then
      line=${line//chown 1000:1000 \/data\/media \/data\/incomplete/chown 1000:1000 \/data\/incomplete}
    fi
    case "$selinux_mode:$line" in
      Enforcing:Volume=anishelf-*.volume:*|Permissive:Volume=anishelf-*.volume:*)
        case "$line" in *:ro) line="$line,z";; *) line="$line:z";; esac;;
    esac
    printf '%s\n' "$line"
  done < "$stage_dir/$name" > "$stage_dir/bundle/quadlet/$name"
}
detect_engine() {
  if [[ -n "$engine" ]]; then
    [[ "$engine" == docker || "$engine" == podman ]] || die 'Engine must be docker or podman.'
  else
    local -a available=()
    command -v docker >/dev/null 2>&1 && available+=(docker)
    command -v podman >/dev/null 2>&1 && available+=(podman)
    case "${#available[@]}" in
      0) die 'Install Docker or Podman first; for offline generation, pass --engine docker or --engine podman.';;
      1) engine=${available[0]}; log "Detected $engine; using it automatically.";;
      *) while :; do
           ask 'Container engine: 1 Docker, 2 Podman' 1
           case "$answer" in 1|docker) engine=docker; break;; 2|podman) engine=podman; break;; esac
         done;;
    esac
  fi
  method=compose
  if [[ "$engine" == podman ]]; then
    [[ "$(id -u)" == 0 ]] || podman_rootless=true
    while :; do
      ask 'Deployment: 1 Podman Compose, 2 rootless Podman Quadlet' 1
      case "$answer" in 1|compose) break;; 2|quadlet) method=quadlet; break;; esac
    done
  fi
}
preflight() {
  need "$engine"
  if [[ "$engine" == podman ]]; then
    podman info >/dev/null
    podman_rootless=$(podman info --format '{{.Host.Security.Rootless}}')
    [[ -z "$(podman ps -aq --filter volume=anishelf-app)" ]] || die 'Existing containers already use anishelf-app. Reuse their deployment configuration.'
  fi
  if [[ "$method" == compose ]]; then
    "$engine" compose version >/dev/null || die "$engine compose is unavailable. Install its Compose provider before retrying."
    "$engine" info >/dev/null
    [[ -z "$("$engine" ps -aq --filter label=com.docker.compose.project=anishelf)" ]] ||
      die 'An anishelf Compose project already exists. Use its existing configuration to update it.'
    [[ -z "$("$engine" ps -aq --filter volume=anishelf-app)" ]] || die 'Existing containers already use anishelf-app. Reuse their deployment configuration.'
    if [[ "$podman_rootless" == true ]]; then
      local candidate
      for candidate in "$app_port" "$qbit_port" "$peer_port" "$jackett_port"; do
        ((candidate >= 1024)) || die 'Rootless Podman host ports must be 1024 or higher.'
      done
    fi
  else
    [[ "$(uname -s)" == Linux ]] || die 'Quadlet startup requires Linux.'
    [[ "$(id -u)" != 0 ]] || die 'Run rootless Quadlet as a non-root service user, not through sudo.'
    need systemctl
    [[ "$(podman info --format '{{.Host.CgroupsVersion}}')" == v2 ]] || die 'Quadlet requires cgroup v2.'
    [[ "$podman_rootless" == true ]] || die 'Podman must be rootless.'
    systemctl --user show-environment >/dev/null
    local file
    for file in "$quadlet_dir"/anishelf* "$systemd_dir"/anishelf*; do
      exists "$file" && die "Existing Anishelf unit is preserved: $file"
    done
  fi
  return 0
}
render_podman_compose() {
  # Rootless containers share the same keep-id mapping as the canonical Quadlets.
  # LinuxServer init still runs as container root, as does the credential initializer.
  local line service= in_services=yes
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" != volumes: ]] || in_services=no
    printf '%s\n' "$line"
    if [[ "$in_services" == yes && "$line" =~ ^\ \ ([a-z][a-z0-9-]*):$ ]]; then
      service=${BASH_REMATCH[1]}
      printf '    userns_mode: keep-id:uid=1000,gid=1000\n'
      case "$service" in qbittorrent|jackett) printf '    user: "0:0"\n';; esac
    fi
  done < "$stage_dir/bundle/compose.yaml" > "$stage_dir/podman-compose.yaml"
  mv "$stage_dir/podman-compose.yaml" "$stage_dir/bundle/compose.yaml"
}

compose() {
  # Shell environment must not override the answers saved in this bundle.
  (
    unset ANISHELF_TAG ANISHELF_BIND_ADDRESS ANISHELF_PORT ANISHELF_PUBLIC_ORIGIN ANISHELF_MEDIA_PATH
    unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES ANISHELF_TRUSTED_PROXIES
    unset QBITTORRENT_WEBUI_PORT QBITTORRENT_PEER_PORT QBITTORRENT_BIND_ADDRESS QBITTORRENT_TAG JACKETT_PORT JACKETT_BIND_ADDRESS
    "$engine" compose --project-name anishelf --env-file "$deploy_dir/.env" -f "$deploy_dir/compose.yaml" "$@"
  )
}
publish_unit() {
  local source=$1 destination=$2
  # Refuse existing paths, including symlinks; noclobber also fences concurrent writes.
  exists "$destination" && die "Existing unit is preserved: $destination"
  (set -C; cat "$source" > "$destination")
}
main() {
  while (($#)); do
    case "$1" in
      --generate-only) generate_only=true; shift;;
      --ref|--templates-dir|--engine)
        (($# >= 2)) || die "Missing value for $1"
        if [[ "$1" == --ref ]]; then source_ref=$2
        elif [[ "$1" == --engine ]]; then engine=$2
        else templates_dir=$2; fi
        shift 2;;
      --help|-h) usage; return;;
      *) die "Unknown option: $1";;
    esac
  done
  [[ "$source_ref" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die 'Invalid source ref.'
  if [[ -n "$templates_dir" ]]; then
    [[ -d "$templates_dir" ]] || die 'Template directory does not exist.'
    templates_dir=$(cd "$templates_dir" && pwd -P)
  else need curl; fi
  # Works when downloaded through a pipe; local/automated runs may supply stdin.
  if ! { exec 3</dev/tty; } 2>/dev/null; then exec 3<&0; fi
  log 'Interactive deployment: existing configurations and media permissions are never overwritten.'
  detect_engine
  while :; do
    ask 'New deployment directory (absolute path)' "$HOME/anishelf"
    if valid_path "$answer" && ! exists "$answer"; then deploy_dir=$answer; break; fi
    log 'Choose a new absolute directory. Quotes, $, %, backslashes, colons and control characters are unsupported.'
  done
  image_tag=latest
  bind_address=127.0.0.1
  app_port=3000
  public_origin=http://localhost:3000
  qbit_port=8080; peer_port=6881; jackett_port=9117
  while :; do
    ask 'Existing dedicated media directory; leave blank for a managed volume' ''
    if [[ -z "$answer" ]]; then media_path=; break; fi
    if valid_path "$answer" && [[ -d "$answer" && -r "$answer" && -x "$answer" ]]; then
      media_path=$(cd "$answer" && pwd -P)
      valid_path "$media_path" || die 'Resolved media path contains unsupported configuration characters.'
      break
    fi
    log 'Choose an existing readable/traversable absolute media directory, or leave blank.'
  done
  selinux_suffix=
  selinux_mode=unavailable
  if command -v getenforce >/dev/null 2>&1; then selinux_mode=$(getenforce); fi
  local relabel_default=no
  case "$selinux_mode" in Enforcing|Permissive) relabel_default=yes;; esac
  if [[ -n "$media_path" && "$relabel_default" == yes ]]; then selinux_suffix=,z; fi
  yes_no 'Include bundled qBittorrent' no; qbit=$answer
  yes_no 'Include bundled Jackett' no; jackett=$answer
  yes_no 'Adjust advanced options (image tag, networking, ports and SELinux)' no
  if [[ "$answer" == yes ]]; then
    while :; do
      ask 'Matching Anishelf Web/Backend image tag' "$image_tag"
      [[ "$answer" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] && { image_tag=$answer; break; }
      log 'Enter a valid container image tag.'
    done
    while :; do
      ask 'Application bind IPv4 address' "$bind_address"
      valid_ipv4 "$answer" && { bind_address=$answer; break; }
      log 'Enter an IPv4 address, for example 127.0.0.1 or 0.0.0.0.'
    done
    port 'Application host port' "$app_port"; app_port=$answer
    while :; do
      ask 'Browser origin (scheme, hostname and optional port only)' "http://localhost:$app_port"
      valid_origin "$answer" && { public_origin=$answer; break; }
      log 'Enter an HTTP(S) origin without credentials, paths, query or fragment.'
    done
    if [[ "$qbit" == yes ]]; then
      port 'qBittorrent WebUI host port (loopback only)' "$qbit_port"; qbit_port=$answer
      port 'qBittorrent peer TCP/UDP port' "$peer_port"; peer_port=$answer
    fi
    if [[ "$jackett" == yes ]]; then port 'Jackett WebUI host port (loopback only)' "$jackett_port"; jackett_port=$answer; fi
    if [[ -n "$media_path" ]]; then
      yes_no 'Apply shared SELinux :z label to this dedicated media directory' "$relabel_default"
      if [[ "$answer" == yes ]]; then selinux_suffix=,z; else selinux_suffix=; fi
    fi
  fi
  if [[ -n "$media_path" && -n "$selinux_suffix" ]]; then
    log "SELinux: $selinux_mode. Shared :z will relabel the selected media tree when containers start."
    case "$media_path" in /|/home|/root|/etc|/etc/*|/private/etc|/private/etc/*|/usr|/usr/*|/boot|/boot/*|/bin|/bin/*|/sbin|/sbin/*|/lib|/lib/*|/lib64|/lib64/*|/var|/var/*|/sys|/sys/*|/proc|/proc/*|/dev|/dev/*|/run|/run/*)
      die 'Refusing to relabel a system directory. Choose a dedicated media directory or pre-label it manually.';;
    esac
    [[ "$media_path" != "$HOME" ]] || die 'Refusing to relabel your entire home directory.'
  fi
  if [[ "$qbit" == yes && -n "$media_path" && ! -w "$media_path" ]]; then
    die 'Bundled qBittorrent requires a writable media directory; permissions will not be changed automatically.'
  fi
  local ports=" $app_port " selected_port
  for selected_port in $(if [[ "$qbit" == yes ]]; then printf '%s %s ' "$qbit_port" "$peer_port"; fi; if [[ "$jackett" == yes ]]; then printf '%s' "$jackett_port"; fi); do
    [[ "$ports" != *" $selected_port "* ]] || die 'Selected TCP ports must be distinct.'
    ports="$ports$selected_port "
  done
  quadlet_dir=${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd
  systemd_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
  log "Plan: $engine/$method; directory=$deploy_dir; image=$image_tag; bind=$bind_address:$app_port; origin=$public_origin"
  log "Media: ${media_path:-managed volume}; SELinux shared relabel=${selinux_suffix:-no}; qBittorrent=$qbit; Jackett=$jackett"
  if [[ "$generate_only" == true ]]; then
    yes_no 'Write configuration only (no engine or systemd changes)' yes
  else yes_no 'Create configuration and start this deployment' yes; fi
  [[ "$answer" == yes ]] || { log 'Cancelled; nothing was written.'; return; }
  if [[ "$generate_only" != true ]]; then phase='checking runtime prerequisites'; need curl; preflight; fi
  phase='preparing deployment templates'
  stage_dir=$(mktemp -d "${TMPDIR:-/tmp}/anishelf-install.XXXXXX")
  mkdir "$stage_dir/bundle"
  source_commit=local
  if [[ -z "$templates_dir" ]]; then
    fetch "https://api.github.com/repos/$repository/commits/$source_ref" "$stage_dir/commit.json"
    source_commit=$(sed -n 's/^[[:space:]]*"sha": "\([a-f0-9]\{40\}\)".*/\1/p' "$stage_dir/commit.json" | sed -n '1p')
    [[ "$source_commit" =~ ^[a-f0-9]{40}$ ]] || die 'GitHub did not return a valid template commit.'
  fi
  if [[ "$method" == compose ]]; then
    asset compose.yaml "$stage_dir/bundle/compose.yaml"
    if [[ -n "$selinux_suffix" ]]; then
      sed -e 's|:/data/media:ro$|:/data/media:ro,z|' -e 's|}:/data/media$|}:/data/media:z|' \
        "$stage_dir/bundle/compose.yaml" > "$stage_dir/compose-labeled.yaml"
      mv "$stage_dir/compose-labeled.yaml" "$stage_dir/bundle/compose.yaml"
    fi
    if [[ -n "$media_path" ]]; then
      sed 's|chown "\$\${PUID}:\$\${PGID}" /data/media /data/incomplete|chown "\$\${PUID}:\$\${PGID}" /data/incomplete|' \
        "$stage_dir/bundle/compose.yaml" > "$stage_dir/compose-no-host-chown.yaml"
      mv "$stage_dir/compose-no-host-chown.yaml" "$stage_dir/bundle/compose.yaml"
    fi
    if [[ "$engine" == podman && "$podman_rootless" == true ]]; then render_podman_compose; fi
    : > "$stage_dir/bundle/.env"
    write_env ANISHELF_TAG "$image_tag"; write_env ANISHELF_BIND_ADDRESS "$bind_address"
    write_env ANISHELF_PORT "$app_port"; write_env ANISHELF_PUBLIC_ORIGIN "$public_origin"
    write_env ANISHELF_MEDIA_PATH "$media_path"
    local profiles=
    [[ "$qbit" != yes ]] || profiles=qbittorrent
    if [[ "$jackett" == yes ]]; then profiles="${profiles:+$profiles,}jackett"; fi
    write_env COMPOSE_PROFILES "$profiles"
    write_env COMPOSE_PROJECT_NAME anishelf
    write_env ANISHELF_DEPLOY_ENGINE "$engine"
    write_env ANISHELF_TRUSTED_PROXIES loopback,uniquelocal
    write_env QBITTORRENT_WEBUI_PORT "$qbit_port"; write_env QBITTORRENT_PEER_PORT "$peer_port"
    write_env JACKETT_PORT "$jackett_port"
    write_env QBITTORRENT_BIND_ADDRESS 127.0.0.1; write_env JACKETT_BIND_ADDRESS 127.0.0.1
    write_env QBITTORRENT_TAG latest
  else
    mkdir "$stage_dir/bundle/quadlet"
    local -a units=(anishelf.network anishelf-app.volume anishelf-media.volume anishelf-qbittorrent-connection.volume anishelf-jackett-config.volume anishelf-backend.container anishelf-web.container anishelf.target)
    if [[ "$qbit" == yes ]]; then units+=(anishelf-qbittorrent-config.volume anishelf-qbittorrent-incomplete.volume anishelf-qbittorrent-init.container anishelf-qbittorrent.container); fi
    if [[ "$jackett" == yes ]]; then units+=(anishelf-jackett.container); fi
    local unit
    for unit in "${units[@]}"; do asset "quadlet/$unit" "$stage_dir/$unit"; render_unit "$unit"; done
  fi
  phase='writing the new deployment bundle'
  # mkdir refuses existing/symlink destinations, even if they appeared after prompting.
  mkdir -p "$(dirname "$deploy_dir")"
  mkdir "$deploy_dir"
  cp -R "$stage_dir/bundle/." "$deploy_dir/"
  log_file="$deploy_dir/install.log"
  log "Configuration saved. Engine=$engine; method=$method; rootless=$podman_rootless; template revision=$source_commit; SELinux=$selinux_mode."
  if [[ "$generate_only" == true ]]; then log 'Generation complete; no services or systemd units were changed.'; return; fi
  if [[ "$method" == compose ]]; then
    phase='validating Compose configuration'; compose config --quiet
    phase='pulling container images'; compose pull
    phase='starting Compose services'; compose up -d
    log "Read the initial password with: $engine compose --project-name anishelf --project-directory \"$deploy_dir\" logs backend"
  else
    phase='installing rootless Quadlet units'
    preflight
    mkdir -p "$quadlet_dir" "$systemd_dir"
    for unit in "$deploy_dir/quadlet/"*; do
      if [[ "${unit##*/}" == anishelf.target ]]; then publish_unit "$unit" "$systemd_dir/anishelf.target"
      else publish_unit "$unit" "$quadlet_dir/${unit##*/}"; fi
    done
    systemctl --user daemon-reload
    systemctl --user cat anishelf-backend.service >/dev/null
    phase='starting rootless Quadlet services'
    systemctl --user enable --now anishelf.target
    systemctl --user is-active --quiet anishelf-backend.service anishelf-web.service
    if [[ "$qbit" == yes ]]; then systemctl --user is-active --quiet anishelf-qbittorrent.service; fi
    if [[ "$jackett" == yes ]]; then systemctl --user is-active --quiet anishelf-jackett.service; fi
    if command -v loginctl >/dev/null 2>&1 && [[ "$(loginctl show-user "$(id -u)" -p Linger --value)" != yes ]]; then
      log "For operation after logout/reboot, an administrator must enable lingering for $(id -un)."
    fi
    log 'Read the initial password with: journalctl --user -u anishelf-backend.service'
  fi
  phase='checking application health'
  local attempt health_host=$bind_address
  [[ "$health_host" != 0.0.0.0 ]] || health_host=127.0.0.1
  for attempt in {1..30}; do
    if curl --fail --silent --max-time 3 -H "Host: localhost:$app_port" "http://$health_host:$app_port/api/health" >/dev/null; then
      log "Deployment is healthy. Open $public_origin; configure external services in Settings."
      return
    fi
    sleep 2
  done
  die 'Services started but local HTTP health did not pass. Configuration and data are retained; inspect service logs.'
}
main "$@"
