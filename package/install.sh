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
action=install
existing_dir=
backup_dir=
stack=anishelf
test_mode=false
force=false
conflict_backup=

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
Usage: bash install.sh [--generate-only] [--test] [--ref REF] [--templates-dir DIRECTORY] [--engine docker|podman]
       bash install.sh --remove DIRECTORY
       bash install.sh --reconfigure DIRECTORY [--ref REF] [--templates-dir DIRECTORY]

Configure Docker Compose or rootless Podman Quadlet interactively.
--test           Isolated testing deployment: testing images, port 3001, separate
                 anishelf-test services/volumes. Host media mounts are disabled.
--generate-only  Write a new deployment bundle without contacting a container engine
                 or installing systemd units. No existing files are overwritten.
--remove DIRECTORY       Stop a saved deployment and archive/remove its active configuration.
--reconfigure DIRECTORY  Prepare fresh configuration, then stop/archive the saved
                         deployment and start the replacement in the same directory.
                         Both modes preserve all volumes and host media.
--force          Back up conflicting regular Quadlet unit files before replacing/removing them.
--ref REF        GitHub branch, tag or commit for deployment templates (default main).
                 Branch/tag names containing slashes are not supported.
--templates-dir  Use local package/deploy templates instead of GitHub (maintainers).
--engine         Explicit engine for automated generation; normally auto-detected.
--help           Show this help.

Requires Bash and curl; Docker deployments need Docker Compose v2. Quadlet needs Linux with rootless Podman, cgroup v2, Quadlet
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
absolute_input() { case "$1" in /*) printf '%s\n' "$1";; *) printf '%s/%s\n' "$PWD" "$1";; esac; }
known_unit() {
  case "${1/#$stack/anishelf}" in
    anishelf.network|anishelf.target|anishelf-app.volume|anishelf-media.volume|anishelf-qbittorrent-connection.volume|anishelf-qbittorrent-config.volume|anishelf-qbittorrent-incomplete.volume|anishelf-jackett-config.volume|anishelf-backend.container|anishelf-web.container|anishelf-qbittorrent-init.container|anishelf-qbittorrent.container|anishelf-jackett-init.container|anishelf-jackett.container) return 0;;
    *) return 1;;
  esac
}
backup_conflict() {
  local source=$1 name=${1##*/}
  [[ "$force" == true && -f "$source" && ! -L "$source" ]] || die "Existing Quadlet unit is preserved: $source (use --force for regular files)."
  if [[ -z "$conflict_backup" ]]; then
    conflict_backup=$(mktemp -d "${deploy_dir:-$existing_dir}.quadlet-backup.XXXXXX")
    log "Conflicting Quadlet unit backup: $conflict_backup"
  fi
  [[ ! -e "$conflict_backup/$name" ]] || die "Conflict already backed up: $name"
  cp -p -- "$source" "$conflict_backup/$name"
  cmp -s "$source" "$conflict_backup/$name" || die "Quadlet unit changed during backup: $source"
  log "Backed up conflicting Quadlet unit: $source"
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
# Quadlet Volume= is literal; the generator quotes the resulting argv.
render_unit() {
  local name=$1 line extra index=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$name:$line" in
      *:Image=ghcr.io/qw0er/anishelf-backend:*) line="Image=ghcr.io/qw0er/anishelf-backend:$image_tag";;
      *:Image=ghcr.io/qw0er/anishelf-web:*) line="Image=ghcr.io/qw0er/anishelf-web:$image_tag";;
      anishelf-backend.container:Environment=ANISHELF_INITIAL_RESOURCE_ROOTS=*) line="Environment=ANISHELF_INITIAL_RESOURCE_ROOTS=$initial_roots";;
      *:Environment=ANISHELF_PUBLIC_ORIGIN=*) line="Environment=ANISHELF_PUBLIC_ORIGIN=$public_origin";;
      anishelf-web.container:Environment=\"ANISHELF_WEB_TRUSTED_PROXIES=*) line="Environment=\"ANISHELF_WEB_TRUSTED_PROXIES=$web_trusted_proxies\"";;
      anishelf-web.container:PublishPort=*) line="PublishPort=$bind_address:$app_port:8080";;
      anishelf-jackett.container:PublishPort=*) line="PublishPort=127.0.0.1:$jackett_port:9117";;
      anishelf-qbittorrent.container:Environment=TORRENTING_PORT=*) line="Environment=TORRENTING_PORT=$peer_port";;
      anishelf-qbittorrent.container:PublishPort=127.0.0.1:8080:8080) line="PublishPort=127.0.0.1:$qbit_port:8080";;
      anishelf-qbittorrent.container:PublishPort=6881:6881) line="PublishPort=$peer_port:$peer_port";;
      anishelf-qbittorrent.container:PublishPort=6881:6881/udp) line="PublishPort=$peer_port:$peer_port/udp";;
      *:Volume=anishelf-media.volume:/data/media:rw)
        if [[ -n "$media_path" ]]; then line="Volume=$media_path:/data/media:rw$selinux_suffix"; fi;;
      *:Volume=anishelf-media.volume:/data/media)
        if [[ -n "$media_path" ]]; then line="Volume=$media_path:/data/media${selinux_suffix:+:z}"; fi;;
    esac
    if [[ -n "$media_path" && "$name" == anishelf-qbittorrent.container ]]; then
      line=${line//chown 1000:1000 \/data\/media \/data\/incomplete/chown 1000:1000 \/data\/incomplete}
    fi
    case "$selinux_mode:$line" in
      Enforcing:Volume=anishelf-*.volume:*|Permissive:Volume=anishelf-*.volume:*)
        case "$line" in *:ro|*:rw) line="$line,z";; *) line="$line:z";; esac;;
    esac
    printf '%s\n' "$line"
    if [[ "$name" == anishelf-backend.container && "$line" == Volume=*:/data/media:rw* ]]; then
      for extra in ${extra_paths[@]+"${extra_paths[@]}"}; do
        index=$((index + 1))
        printf 'Volume=%s\n' "$extra:/data/extra/$index:rw$selinux_suffix"
      done
    fi
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
    method=quadlet
    [[ "$podman_rootless" == true ]] || die 'Run rootless Quadlet as a non-root service user, not through sudo.'
    log 'Podman selected; using rootless Quadlet.'
  fi
}
preflight() {
  need "$engine"
  if [[ "$engine" == podman ]]; then
    podman info >/dev/null
    podman_rootless=$(podman info --format '{{.Host.Security.Rootless}}')
    [[ "${1:-}" == replacement || -z "$(podman ps -aq --filter volume="$stack-app")" ]] || die 'Existing containers already use anishelf-app. Reuse their deployment configuration.'
  fi
  if [[ "$method" == compose ]]; then
    docker compose version >/dev/null || die 'Docker Compose v2 is required.'
    "$engine" info >/dev/null
    [[ "${1:-}" == replacement || -z "$("$engine" ps -aq --filter label=com.docker.compose.project="$stack")" ]] ||
      die 'An anishelf Compose project already exists. Use its existing configuration to update it.'
    [[ "${1:-}" == replacement || -z "$("$engine" ps -aq --filter volume="$stack-app")" ]] || die 'Existing containers already use anishelf-app. Reuse their deployment configuration.'

  else
    [[ "$(uname -s)" == Linux ]] || die 'Quadlet startup requires Linux.'
    [[ "$(id -u)" != 0 ]] || die 'Run rootless Quadlet as a non-root service user, not through sudo.'
    need systemctl
    [[ "$(podman info --format '{{.Host.CgroupsVersion}}')" == v2 ]] || die 'Quadlet requires cgroup v2.'
    [[ "$podman_rootless" == true ]] || die 'Podman must be rootless.'
    systemctl --user show-environment >/dev/null
    local file
    for file in "$quadlet_dir"/"$stack"* "$systemd_dir"/"$stack"*; do
      [[ "$stack" != anishelf || "${file##*/}" != anishelf-test* ]] || continue
      if exists "$file"; then
        if [[ "${1:-}" == replacement && -f "$existing_dir/quadlet/${file##*/}" && ! -L "$file" ]] && cmp -s "$file" "$existing_dir/quadlet/${file##*/}"; then continue; fi
        [[ "$force" == true && -f "$file" && ! -L "$file" ]] && known_unit "${file##*/}" || die "Existing Anishelf unit is preserved: $file"
      fi
    done
  fi
  return 0
}

compose() {
  # Shell environment must not override the answers saved in this bundle.
  (
    unset ANISHELF_TAG ANISHELF_BIND_ADDRESS ANISHELF_PORT ANISHELF_PUBLIC_ORIGIN ANISHELF_MEDIA_PATH
    unset ANISHELF_ALLOWED_HOSTS ANISHELF_WEB_TRUSTED_PROXIES
    unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES ANISHELF_TRUSTED_PROXIES
    unset QBITTORRENT_WEBUI_PORT QBITTORRENT_PEER_PORT QBITTORRENT_BIND_ADDRESS QBITTORRENT_TAG JACKETT_PORT JACKETT_BIND_ADDRESS
    # Read only the installer's validated field; never source the saved file.
    local saved_profiles
    saved_profiles=$(sed -n "s/^COMPOSE_PROFILES='\([^']*\)'$/\1/p" "$deploy_dir/.env")
    case "$saved_profiles" in
      ''|qbittorrent|jackett|qbittorrent,jackett) ;;
      *) die 'Unrecognized saved Compose profiles.';;
    esac
    case ",$saved_profiles," in *,qbittorrent,*) set -- --profile qbittorrent "$@";; esac
    case ",$saved_profiles," in *,jackett,*) set -- --profile jackett "$@";; esac
    log "Compose project=$stack; enabled profiles=${saved_profiles:-none}"
    docker compose --project-name "$stack" --env-file "$deploy_dir/.env" -f "$deploy_dir/compose.yaml" "$@"
  )
}
publish_unit() {
  local source=$1 destination=$2
  # Refuse existing paths, including symlinks; noclobber also fences concurrent writes.
  if exists "$destination"; then
    backup_conflict "$destination"
    rm -- "$destination"
  fi
  (set -C; cat "$source" > "$destination")
}
pull_quadlet_images() {
  local unit line image
  local -a pulled=()
  for unit in "$stage_dir/bundle/quadlet/"*.container; do
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" == Image=* ]] || continue
      image=${line#Image=}
      [[ " ${pulled[*]-} " != *" $image "* ]] || continue
      log "Pulling Quadlet image: $image"
      podman pull "$image"
      pulled+=("$image")
    done < "$unit"
  done
}
# Manage only a saved installer bundle, never an arbitrary source checkout.
load_existing() {
  existing_dir=$(absolute_input "$existing_dir")
  valid_path "$existing_dir" && [[ -d "$existing_dir" && ! -L "$existing_dir" ]] || die 'Choose a real saved deployment directory.'
  existing_dir=$(cd "$existing_dir" && pwd -P)
  if [[ -f "$existing_dir/.deployment-profile" && ! -L "$existing_dir/.deployment-profile" ]]; then
    local saved_profile
    saved_profile=$(cat "$existing_dir/.deployment-profile")
    case "$saved_profile" in
      testing) stack=anishelf-test; test_mode=true;;
      production) [[ "$test_mode" == false ]] || die 'Cannot apply --test to a production bundle.'; stack=anishelf;;
      *) die 'Unrecognized deployment profile.';;
    esac
  elif [[ "$test_mode" == true ]]; then die 'Cannot apply --test to an existing production bundle.'; fi
  if exists "$existing_dir/compose.yaml" && exists "$existing_dir/quadlet"; then die 'Mixed deployment bundles must be reconciled manually.'; fi
  if [[ -f "$existing_dir/compose.yaml" && ! -L "$existing_dir/compose.yaml" && -f "$existing_dir/.env" && ! -L "$existing_dir/.env" ]]; then
    old_method=compose
    old_engine=$(sed -En "s/^ANISHELF_DEPLOY_ENGINE='(docker|podman)'$/\1/p" "$existing_dir/.env")
    [[ "$old_engine" != podman ]] || die 'Podman Compose is no longer supported. Manage this existing deployment manually; no files or services were changed.'
    [[ "$old_engine" == docker ]] || die 'Not a recognized installer Compose bundle.'
    [[ -z "$engine" || "$engine" == "$old_engine" ]] || die 'Use the original engine to preserve its volumes.'
  elif [[ -d "$existing_dir/quadlet" && ! -L "$existing_dir/quadlet" && -f "$existing_dir/quadlet/$stack-backend.container" && -f "$existing_dir/quadlet/$stack-web.container" && -f "$existing_dir/quadlet/$stack.target" ]]; then
    old_method=quadlet; old_engine=podman
    [[ -z "$engine" || "$engine" == podman ]] || die 'Use the original engine to preserve its volumes.'
    local unit name destination
    for unit in "$existing_dir/quadlet/"*; do
      name=${unit##*/}
      case "${name/#$stack/anishelf}" in
        anishelf.network|anishelf.target|anishelf-app.volume|anishelf-media.volume|anishelf-qbittorrent-connection.volume|anishelf-qbittorrent-config.volume|anishelf-qbittorrent-incomplete.volume|anishelf-jackett-config.volume|anishelf-backend.container|anishelf-web.container|anishelf-qbittorrent-init.container|anishelf-qbittorrent.container|anishelf-jackett-init.container|anishelf-jackett.container) ;;
        *) die "Unrecognized bundle unit: $name";;
      esac
      [[ -f "$unit" && ! -L "$unit" ]] || die "Bundle unit must be a regular file: $unit"
      destination="${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd/$name"
      [[ "$name" != "$stack.target" ]] || destination="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$name"
      if exists "$destination"; then
        if ! { [[ -f "$destination" && ! -L "$destination" ]] && cmp -s "$unit" "$destination"; }; then
          [[ "$force" == true && -f "$destination" && ! -L "$destination" ]] || die "Installed unit differs from the bundle; reconcile it first or use --force: $destination"
        fi
      fi
    done
  else die 'Not a recognized saved installer deployment; source checkouts cannot be removed.'; fi
  engine=$old_engine
  log "Selected saved deployment: $existing_dir ($old_engine/$old_method). Volumes and media will be preserved."
}
remove_configuration() {
  phase='archiving existing deployment configuration'
  # Recheck installed units immediately before stopping/removing anything.
  load_existing
  mv --version >/dev/null 2>&1 || die 'Configuration archival requires GNU mv (coreutils).'
  backup_dir=$(mktemp -d "$existing_dir.backup.XXXXXX")
  log_file="$existing_dir/removal.log"
  log "Archiving configuration in $backup_dir before stopping services."
  if [[ "$old_method" == compose ]]; then
    phase='stopping existing Compose deployment'
    local saved_dir=${deploy_dir:-}
    deploy_dir=$existing_dir
    compose --profile qbittorrent --profile jackett config --quiet
    compose --profile qbittorrent --profile jackett down --remove-orphans
    deploy_dir=$saved_dir
  else
    need systemctl; need podman
    [[ "$(id -u)" != 0 ]] || die 'Manage rootless Quadlet as the original non-root service user.'
    phase='stopping existing Quadlet deployment'
    if exists "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$stack.target"; then systemctl --user stop "$stack.target"; fi
    # Stop optional and oneshot services too, including ones outside target dependencies.
    local unit name destination
    for unit in "$existing_dir/quadlet/"*.container; do
      name=${unit##*/}
      if exists "${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd/$name"; then systemctl --user stop "${name%.container}.service"; fi
    done
    if exists "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$stack.target"; then systemctl --user disable "$stack.target"; fi
    for unit in "$existing_dir/quadlet/"*; do
      name=${unit##*/}
      destination="${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd/$name"
      [[ "$name" != "$stack.target" ]] || destination="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$name"
      if exists "$destination"; then
        if ! { [[ ! -L "$destination" ]] && cmp -s "$unit" "$destination"; }; then backup_conflict "$destination"; fi
        rm -- "$destination"
      fi
    done
    systemctl --user daemon-reload
  fi
  phase='renaming the entire old deployment directory'
  # GNU mv replaces only the reserved empty directory, never nests the old bundle.
  mv -T -- "$existing_dir" "$backup_dir"
  log_file="$backup_dir/removal.log"
  log "Active configuration removed; backup: $backup_dir. All volumes and host media are preserved."
}
main() {
  while (($#)); do
    case "$1" in
      --test) test_mode=true; stack=anishelf-test; shift;;
      --force) force=true; shift;;
      --generate-only) generate_only=true; shift;;
      --remove|--reconfigure)
        (($# >= 2)) || die "Missing directory for $1"
        [[ "$action" == install ]] || die 'Choose only one deployment action.'
        action=${1#--}; existing_dir=$2; shift 2;;
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
  [[ "$action" == install || "$generate_only" == false ]] || die 'Existing deployment actions cannot use --generate-only.'
  [[ "$source_ref" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die 'Invalid source ref.'
  if [[ -n "$templates_dir" ]]; then
    [[ -d "$templates_dir" ]] || die 'Template directory does not exist.'
    templates_dir=$(cd "$templates_dir" && pwd -P)
  elif [[ "$action" != remove ]]; then need curl; fi
  # Works when downloaded through a pipe; local/automated runs may supply stdin.
  if ! { exec 3</dev/tty; } 2>/dev/null; then exec 3<&0; fi
  if [[ "$action" != install ]]; then
    load_existing
    if [[ "$action" == remove ]]; then
      yes_no 'Stop this deployment and remove its active configuration (data is preserved)' no
      [[ "$answer" == yes ]] || { log 'Cancelled; nothing was changed.'; return; }
      remove_configuration
      return
    fi
  fi
  log 'Interactive deployment: review the configuration before applying changes.'
  if [[ "$action" == reconfigure ]]; then
    method=$old_method
    if [[ "$engine" == podman && "$(id -u)" != 0 ]]; then podman_rootless=true; fi
  else detect_engine; fi
  while :; do
    if [[ "$action" == reconfigure ]]; then
      [[ "$method" == "$old_method" ]] || die 'Reconfiguration must retain the deployment method to preserve volume identities.'
      deploy_dir=$existing_dir; break
    fi
    ask 'New deployment directory (absolute or relative path)' "$HOME/$stack"
    answer=$(absolute_input "$answer")
    if valid_path "$answer" && ! exists "$answer"; then deploy_dir=$answer; break; fi
    log 'Choose a new directory. Quotes, $, %, backslashes, colons and control characters are unsupported.'
  done
  image_tag=latest
  bind_address=127.0.0.1
  app_port=3000
  public_origin=
  web_trusted_proxies="127.0.0.1/32 ::1/128"
  qbit_port=8080; peer_port=6881; jackett_port=9117
  if [[ "$test_mode" == true ]]; then
    image_tag=testing; app_port=3001; public_origin=
    qbit_port=8081; peer_port=6882; jackett_port=9118
    log 'Testing profile: isolated services, network and volumes; no host media mounts. Use independent test service credentials.'
  fi
  while :; do
    if [[ "$test_mode" == true ]]; then media_path=; break; fi
    ask 'Existing dedicated media directory; leave blank for a managed volume' ''
    if [[ -z "$answer" ]]; then media_path=; break; fi
    answer=$(absolute_input "$answer")
    if valid_path "$answer" && [[ -d "$answer" && -r "$answer" && -x "$answer" ]]; then
      media_path=$(cd "$answer" && pwd -P)
      valid_path "$media_path" || die 'Resolved media path contains unsupported configuration characters.'
      break
    fi
    log 'Choose an existing readable/traversable media directory, or leave blank.'
  done
  local -a extra_paths=()
  local initial_roots=/data/media extra index
  selinux_suffix=
  selinux_mode=unavailable
  if command -v getenforce >/dev/null 2>&1; then selinux_mode=$(getenforce); fi
  local relabel_default=no
  case "$selinux_mode" in Enforcing|Permissive) relabel_default=yes;; esac
  if [[ -n "$media_path" && "$relabel_default" == yes ]]; then selinux_suffix=,z; fi
  if [[ "$test_mode" != true ]]; then
    yes_no 'Allow access from other devices on the local network' no
    [[ "$answer" != yes ]] || bind_address=0.0.0.0
  fi
  port 'Application host port' "$app_port"; app_port=$answer
  yes_no 'Include bundled qBittorrent' no; qbit=$answer
  yes_no 'Include bundled Jackett' no; jackett=$answer
  yes_no 'Adjust advanced options (image tag, networking, ports, additional media and SELinux)' no
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
    while :; do
      ask 'Optional fixed browser origin for HTTPS; blank enables automatic access' ''
      if [[ -z "$answer" ]] || valid_origin "$answer"; then public_origin=$answer; break; fi
      log 'Enter an HTTP(S) origin without credentials, paths, query or fragment.'
    done
    if [[ "$qbit" == yes ]]; then
      port 'qBittorrent WebUI host port (loopback only)' "$qbit_port"; qbit_port=$answer
      port 'qBittorrent peer TCP/UDP port' "$peer_port"; peer_port=$answer
    fi
    if [[ "$jackett" == yes ]]; then port 'Jackett WebUI host port (loopback only)' "$jackett_port"; jackett_port=$answer; fi
    if [[ "$test_mode" != true ]]; then
      while :; do
        ask 'Additional existing media directories, separated by colon; blank for none' ''
        extra_paths=()
        if [[ -z "$answer" ]]; then break; fi
        if [[ "$answer" == :* || "$answer" == *: || "$answer" == *::* ]]; then
          log 'Enter non-empty directories separated by colons.'; continue
        fi
        local -a candidates=()
        IFS=: read -r -a candidates <<< "$answer"
        if (( ${#candidates[@]} > 63 )); then log 'At most 63 additional directories are supported.'; continue; fi
        local valid=yes candidate resolved previous
        for candidate in "${candidates[@]}"; do
          candidate=$(absolute_input "$candidate")
          if ! valid_path "$candidate" || [[ ! -d "$candidate" || ! -r "$candidate" || ! -x "$candidate" ]]; then valid=no; break; fi
          resolved=$(cd "$candidate" && pwd -P)
          if ! valid_path "$resolved"; then valid=no; break; fi
          if [[ "$resolved" == "$media_path" ]]; then valid=no; break; fi
          for previous in ${extra_paths[@]+"${extra_paths[@]}"}; do
            if [[ "$resolved" == "$previous" || "$resolved" == "$previous/"* || "$previous" == "$resolved/"* ]]; then valid=no; break; fi
          done
          [[ "$valid" == yes ]] || break
          extra_paths+=("$resolved")
        done
        [[ "$valid" != yes ]] || break
        log 'Choose distinct existing readable/traversable directories without nested extra directories.'
      done
    fi
    if [[ -n "$media_path" || -n "${extra_paths[0]+yes}" ]]; then
      yes_no 'Apply shared SELinux :z label to the dedicated host media directories' "$relabel_default"
      if [[ "$answer" == yes ]]; then selinux_suffix=,z; else selinux_suffix=; fi
    fi
  fi
  if [[ -n "$selinux_suffix" ]]; then
    log "SELinux: $selinux_mode. Shared :z will relabel the selected media tree when containers start."
    for extra in ${media_path:+"$media_path"} ${extra_paths[@]+"${extra_paths[@]}"}; do
    case "$extra" in /|/home|/root|/etc|/etc/*|/private/etc|/private/etc/*|/usr|/usr/*|/boot|/boot/*|/bin|/bin/*|/sbin|/sbin/*|/lib|/lib/*|/lib64|/lib64/*|/var|/var/*|/sys|/sys/*|/proc|/proc/*|/dev|/dev/*|/run|/run/*)
      die 'Refusing to relabel a system directory. Choose a dedicated media directory or pre-label it manually.';;
    esac
    [[ "$extra" != "$HOME" ]] || die 'Refusing to relabel your entire home directory.'
    done
  fi
  if [[ "$qbit" == yes && -n "$media_path" && ! -w "$media_path" ]]; then
    die 'Bundled qBittorrent requires a writable media directory; permissions will not be changed automatically.'
  fi
  index=0
  for extra in ${extra_paths[@]+"${extra_paths[@]}"}; do index=$((index + 1)); initial_roots="$initial_roots:/data/extra/$index"; done
  local ports=" $app_port " selected_port
  for selected_port in $(if [[ "$qbit" == yes ]]; then printf '%s %s ' "$qbit_port" "$peer_port"; fi; if [[ "$jackett" == yes ]]; then printf '%s' "$jackett_port"; fi); do
    [[ "$ports" != *" $selected_port "* ]] || die 'Selected TCP ports must be distinct.'
    ports="$ports$selected_port "
  done
  quadlet_dir=${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd
  systemd_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
  log "Plan: $engine/$method; directory=$deploy_dir; image=$image_tag; bind=$bind_address:$app_port; origin=${public_origin:-automatic}"
  log "External proxy trust: $web_trusted_proxies"
  for extra in ${extra_paths[@]+"${extra_paths[@]}"}; do log "Additional media: $extra"; done
  log "Media: ${media_path:-managed volume}; SELinux shared relabel=${selinux_suffix:-no}; qBittorrent=$qbit; Jackett=$jackett"
  if [[ "$generate_only" == true ]]; then
    yes_no 'Write configuration only (no engine or systemd changes)' yes
  elif [[ "$action" == reconfigure ]]; then yes_no 'Archive the old configuration and restart with these new settings' no
  else yes_no 'Create configuration and start this deployment' yes; fi
  [[ "$answer" == yes ]] || { log 'Cancelled; nothing was written.'; return; }
  if [[ "$generate_only" != true ]]; then
    phase='checking runtime prerequisites'; need curl
    if [[ "$action" == install ]]; then preflight; else preflight replacement; fi
  fi
  phase='preparing deployment templates'
  stage_dir=$(mktemp -d "${TMPDIR:-/tmp}/anishelf-install.XXXXXX")
  mkdir "$stage_dir/bundle"
  if [[ "$test_mode" == true ]]; then printf 'testing\n'; else printf 'production\n'; fi > "$stage_dir/bundle/.deployment-profile"
  source_commit=local
  if [[ -z "$templates_dir" ]]; then
    fetch "https://api.github.com/repos/$repository/commits/$source_ref" "$stage_dir/commit.json"
    source_commit=$(sed -n 's/^[[:space:]]*"sha": "\([a-f0-9]\{40\}\)".*/\1/p' "$stage_dir/commit.json" | sed -n '1p')
    [[ "$source_commit" =~ ^[a-f0-9]{40}$ ]] || die 'GitHub did not return a valid template commit.'
  fi
  if [[ "$method" == compose ]]; then
    asset compose.yaml "$stage_dir/bundle/compose.yaml"
    if [[ -n "$selinux_suffix" ]]; then
      sed -e 's|:/data/media:rw$|:/data/media:rw,z|' -e 's|}:/data/media$|}:/data/media:z|' \
        "$stage_dir/bundle/compose.yaml" > "$stage_dir/compose-labeled.yaml"
      mv "$stage_dir/compose-labeled.yaml" "$stage_dir/bundle/compose.yaml"
    fi
    if [[ -n "$media_path" ]]; then
      sed 's|chown "\$\${PUID}:\$\${PGID}" /data/media /data/incomplete|chown "\$\${PUID}:\$\${PGID}" /data/incomplete|' \
        "$stage_dir/bundle/compose.yaml" > "$stage_dir/compose-no-host-chown.yaml"
      mv "$stage_dir/compose-no-host-chown.yaml" "$stage_dir/bundle/compose.yaml"
    fi
    if [[ -n "${extra_paths[0]+yes}" ]]; then
      index=0
      while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" == '      ANISHELF_INITIAL_RESOURCE_ROOTS: /data/media' ]]; then
          printf '      ANISHELF_INITIAL_RESOURCE_ROOTS: %s\n' "$initial_roots"
        else
          printf '%s\n' "$line"
        fi
        if [[ "$line" == *'${ANISHELF_MEDIA_PATH:-anishelf-media}:/data/media:rw'* ]]; then
          for extra in ${extra_paths[@]+"${extra_paths[@]}"}; do
            index=$((index + 1))
            printf '      - "%s:/data/extra/%s:rw%s"\n' "$extra" "$index" "$selinux_suffix"
          done
        fi
      done < "$stage_dir/bundle/compose.yaml" > "$stage_dir/compose-extra.yaml"
      mv "$stage_dir/compose-extra.yaml" "$stage_dir/bundle/compose.yaml"
    fi
    : > "$stage_dir/bundle/.env"
    write_env ANISHELF_TAG "$image_tag"; write_env ANISHELF_BIND_ADDRESS "$bind_address"
    write_env ANISHELF_PORT "$app_port"; write_env ANISHELF_PUBLIC_ORIGIN "$public_origin"
    write_env ANISHELF_MEDIA_PATH "$media_path"
    local profiles=
    [[ "$qbit" != yes ]] || profiles=qbittorrent
    if [[ "$jackett" == yes ]]; then profiles="${profiles:+$profiles,}jackett"; fi
    write_env COMPOSE_PROFILES "$profiles"
    write_env COMPOSE_PROJECT_NAME "$stack"
    write_env ANISHELF_DEPLOY_ENGINE "$engine"
    write_env ANISHELF_TRUSTED_PROXIES loopback,uniquelocal
    write_env ANISHELF_WEB_TRUSTED_PROXIES "$web_trusted_proxies"
    write_env QBITTORRENT_WEBUI_PORT "$qbit_port"; write_env QBITTORRENT_PEER_PORT "$peer_port"
    write_env JACKETT_PORT "$jackett_port"
    write_env QBITTORRENT_BIND_ADDRESS 127.0.0.1; write_env JACKETT_BIND_ADDRESS 127.0.0.1
    write_env QBITTORRENT_TAG latest
  else
    mkdir "$stage_dir/bundle/quadlet"
    local -a units=(anishelf.network anishelf-app.volume anishelf-media.volume anishelf-qbittorrent-connection.volume anishelf-jackett-config.volume anishelf-backend.container anishelf-web.container anishelf.target)
    if [[ "$qbit" == yes ]]; then units+=(anishelf-qbittorrent-config.volume anishelf-qbittorrent-incomplete.volume anishelf-qbittorrent-init.container anishelf-qbittorrent.container); fi
    if [[ "$jackett" == yes ]]; then units+=(anishelf-jackett-init.container anishelf-jackett.container); fi
    local unit
    for unit in "${units[@]}"; do asset "quadlet/$unit" "$stage_dir/$unit"; render_unit "$unit"; done
    log "Rendered ${#units[@]} Quadlet unit files."
  fi
  if [[ "$test_mode" == true ]]; then
    phase='isolating testing deployment resources'
    if [[ "$method" == compose ]]; then
      sed 's/name: anishelf-/name: anishelf-test-/g' "$stage_dir/bundle/compose.yaml" > "$stage_dir/testing-compose.yaml"
      mv "$stage_dir/testing-compose.yaml" "$stage_dir/bundle/compose.yaml"
    else
      local rendered rendered_name
      for rendered in "$stage_dir/bundle/quadlet/"*; do
        rendered_name=${rendered##*/}
        # Namespace resources while preserving registry image names.
        sed -e '/^Image=/!s/anishelf-/anishelf-test-/g' -e 's/^NetworkName=anishelf$/NetworkName=anishelf-test/' -e 's/anishelf\.network/anishelf-test.network/g' -e 's/anishelf\.target/anishelf-test.target/g' "$rendered" > "$stage_dir/bundle/quadlet/${rendered_name/#anishelf/anishelf-test}"
        rm "$rendered"
      done
    fi
  fi
  if [[ "$generate_only" != true && "$method" == quadlet ]]; then
    phase='pulling Quadlet container images'
    pull_quadlet_images
  fi
  if [[ "$action" == reconfigure ]]; then
    if [[ "$method" == compose ]]; then
      phase='validating replacement Compose configuration'
      (deploy_dir="$stage_dir/bundle"; compose config --quiet)
    fi
    remove_configuration
    phase='checking replacement runtime prerequisites'
    preflight
  fi
  phase='writing the new deployment bundle'
  # mkdir refuses existing/symlink destinations, even if they appeared after prompting.
  mkdir -p "$(dirname "$deploy_dir")"
  mkdir "$deploy_dir"
  cp -R "$stage_dir/bundle/." "$deploy_dir/"
  log_file="$deploy_dir/install.log"
  log "Configuration saved. Namespace=$stack; image=$image_tag; Engine=$engine; method=$method; rootless=$podman_rootless; template revision=$source_commit; SELinux=$selinux_mode."
  if [[ "$generate_only" == true ]]; then log 'Generation complete; no services or systemd units were changed.'; return; fi
  if [[ "$method" == compose ]]; then
    phase='validating Compose configuration'; compose config --quiet
    phase='pulling container images'; compose pull
    phase='starting Compose services'; compose up -d
    log "Read the initial password with: $engine compose --project-name $stack --env-file \"$deploy_dir/.env\" -f \"$deploy_dir/compose.yaml\" logs backend"
  else
    phase='installing rootless Quadlet units'
    preflight
    mkdir -p "$quadlet_dir" "$systemd_dir"
    for unit in "$deploy_dir/quadlet/"*; do
      if [[ "${unit##*/}" == "$stack.target" ]]; then publish_unit "$unit" "$systemd_dir/$stack.target"
      else publish_unit "$unit" "$quadlet_dir/${unit##*/}"; fi
    done
    systemctl --user daemon-reload
    systemctl --user cat "$stack-backend.service" >/dev/null
    phase='starting rootless Quadlet services'
    systemctl --user enable --now "$stack.target"
    systemctl --user is-active --quiet "$stack-backend.service" "$stack-web.service"
    if [[ "$qbit" == yes ]]; then systemctl --user is-active --quiet "$stack-qbittorrent.service"; fi
    if [[ "$jackett" == yes ]]; then systemctl --user is-active --quiet "$stack-jackett.service"; fi
    if command -v loginctl >/dev/null 2>&1 && [[ "$(loginctl show-user "$(id -u)" -p Linger --value)" != yes ]]; then
      log "For operation after logout/reboot, an administrator must enable lingering for $(id -un)."
    fi
    log "Read the initial password with: journalctl --user -u $stack-backend.service"
  fi
  phase='checking application health'
  local attempt health_host=$bind_address
  [[ "$health_host" != 0.0.0.0 ]] || health_host=127.0.0.1
  for attempt in {1..30}; do
    if curl --fail --silent --max-time 3 -H "Host: localhost:$app_port" "http://$health_host:$app_port/api/health" >/dev/null; then
      log "Deployment is healthy. Open ${public_origin:-http://localhost:$app_port}; configure external services in Settings."
      if [[ "$bind_address" == 0.0.0.0 && -z "$public_origin" ]]; then
        log "LAN access: open http://SERVER_IP:$app_port from another device."
      fi
      return
    fi
    sleep 2
  done
  die 'Services started but local HTTP health did not pass. Configuration and data are retained; inspect service logs.'
}
main "$@"
