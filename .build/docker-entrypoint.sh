#!/bin/sh
set -eu

# Keep the values ASCII-only so the generated JavaScript has a deterministic
# encoding. Quotes, backslashes, and other printable characters are escaped
# as part of the JSON string encoding below.
export LC_ALL=C

die() {
  printf '%s\n' "docker-entrypoint: $*" >&2
  exit 1
}

validate_nonempty_ascii() {
  _name=$1
  _value=$2
  [ -n "$_value" ] || die "$_name must not be empty"

  case "$_value" in
    *[!\ -~]*) die "$_name contains unsupported control or non-ASCII characters" ;;
  esac
}

validate_optional_ascii() {
  _name=$1
  _value=$2
  [ -z "$_value" ] || validate_nonempty_ascii "$_name" "$_value"
}

validate_url_chars() {
  _name=$1
  _value=$2
  # URL/path characters accepted by the deployment contract. Values are
  # still JSON-escaped before they reach the JavaScript bundle.
  if ! printf '%s\n' "$_value" | awk '
    {
      value = $0
      # Strip IPv6 address delimiters before checking the remaining URL chars.
      gsub(/\[/, "", value)
      gsub(/\]/, "", value)
      if (value ~ /^[A-Za-z0-9._~:\/?#@!$&()*+,;=%-]+$/) valid = 1
    }
    END { exit !valid }
  '; then
    die "$_name has invalid URL/path characters"
  fi
}

validate_api_base() {
  _name=$1
  _value=$2
  validate_nonempty_ascii "$_name" "$_value"

  case "$_value" in
    /|/*) ;;
    http://?*|https://?*) ;;
    *) die "$_name must be an absolute http(s) URL or a relative path" ;;
  esac
  validate_url_chars "$_name" "$_value"
}

validate_ws_url() {
  _name=$1
  _value=$2
  [ -z "$_value" ] && return
  validate_nonempty_ascii "$_name" "$_value"

  case "$_value" in
    ws://?*|wss://?*) ;;
    *) die "$_name must be a ws:// or wss:// URL" ;;
  esac
  validate_url_chars "$_name" "$_value"
}

validate_map_center() {
  _name=$1
  _value=$2
  [ -z "$_value" ] && return
  validate_nonempty_ascii "$_name" "$_value"

  if ! printf '%s\n' "$_value" | awk -F, '
    NF == 2 \
      && $1 ~ /^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$/ \
      && $2 ~ /^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$/ \
      && ($1 + 0) >= -90 && ($1 + 0) <= 90 \
      && ($2 + 0) >= -180 && ($2 + 0) <= 180 { valid = 1 }
    END { exit !valid }
  '; then
    die "$_name must be decimal latitude,longitude within valid ranges"
  fi
}

validate_map_zoom() {
  _name=$1
  _value=$2
  [ -z "$_value" ] && return
  validate_nonempty_ascii "$_name" "$_value"

  if ! printf '%s\n' "$_value" | awk '
    $0 ~ /^[+]?([0-9]+([.][0-9]*)?|[.][0-9]+)$/ \
      && ($0 + 0) >= 0 && ($0 + 0) <= 22 { valid = 1 }
    END { exit !valid }
  '; then
    die "$_name must be a decimal zoom level from 0 through 22"
  fi
}

validate_list() {
  _name=$1
  _value=$2
  _kind=$3
  [ -z "$_value" ] && return
  validate_nonempty_ascii "$_name" "$_value"

  if ! printf '%s\n' "$_value" | awk -F, -v kind="$_kind" '
    {
      for (i = 1; i <= NF; i++) {
        token = $i
        gsub(/^ +| +$/, "", token)
        if (token == "") continue

        found = 1
        token = tolower(token)
        if (kind == "tabs") {
          if (token != "packets" && token != "channels" && token != "map" &&
              token != "nodes" && token != "observers" && token != "routes" &&
              token != "traces" && token != "analytics") bad = 1
        } else if (kind == "themes") {
          if (token != "meshmapper_dark" && token != "meshmapper_light") bad = 1
        }
      }
    }
    END { exit (!found || bad) }
  '; then
    die "$_name contains an unsupported comma-separated value"
  fi
}

validate_skip_splash() {
  _name=$1
  _value=$2
  validate_optional_ascii "$_name" "$_value"
  [ -z "$_value" ] && return

  _normalized=$(printf '%s' "$_value" | tr '[:upper:]' '[:lower:]')
  case "$_normalized" in
    0|1|true|false|yes|no|on|off) ;;
    *) die "$_name must be a boolean value" ;;
  esac
}

# Encode one validated value as a JavaScript-compatible JSON string literal.
# This avoids sed replacement semantics (&, backslashes, and delimiters) and
# also makes backticks and ${...} ordinary data rather than JavaScript syntax.
json_string() {
  _escaped=$(printf '%s' "$1" | awk 'BEGIN { ORS = "" } {
    for (i = 1; i <= length($0); i++) {
      character = substr($0, i, 1)
      if (character == "\\") printf "\\\\"
      else if (character == "\"") printf "\\\""
      else printf "%s", character
    }
  }') || die "failed to encode runtime configuration"
  printf '"%s"\n' "$_escaped"
}

API_BASE="${VITE_API_BASE:-/api/v1}"
WS_URL="${VITE_WS_URL:-}"
# Optional map view — leave empty when unset; the app falls back to a world overview.
MAP_CENTER="${VITE_MAP_CENTER:-}"
MAP_ZOOM="${VITE_MAP_ZOOM:-}"
# Optional branding/customization — empty means default behaviour (all tabs, hidden themes hidden).
DISABLED_TABS="${VITE_DISABLED_TABS:-}"
ENABLED_THEMES="${VITE_ENABLED_THEMES:-}"
SKIP_SPLASH="${VITE_SKIP_SPLASH:-}"
APP_NAME="${VITE_APP_NAME:-BEACON}"

validate_api_base VITE_API_BASE "$API_BASE"
validate_ws_url VITE_WS_URL "$WS_URL"
validate_map_center VITE_MAP_CENTER "$MAP_CENTER"
validate_map_zoom VITE_MAP_ZOOM "$MAP_ZOOM"
validate_list VITE_DISABLED_TABS "$DISABLED_TABS" tabs
validate_list VITE_ENABLED_THEMES "$ENABLED_THEMES" themes
validate_nonempty_ascii VITE_APP_NAME "$APP_NAME"
validate_skip_splash VITE_SKIP_SPLASH "$SKIP_SPLASH"

BEACON_JSON_API_BASE=$(json_string "$API_BASE")
BEACON_JSON_WS_URL=$(json_string "$WS_URL")
BEACON_JSON_MAP_CENTER=$(json_string "$MAP_CENTER")
BEACON_JSON_MAP_ZOOM=$(json_string "$MAP_ZOOM")
BEACON_JSON_DISABLED_TABS=$(json_string "$DISABLED_TABS")
BEACON_JSON_ENABLED_THEMES=$(json_string "$ENABLED_THEMES")
BEACON_JSON_APP_NAME=$(json_string "$APP_NAME")
BEACON_JSON_SKIP_SPLASH=$(json_string "$SKIP_SPLASH")
export BEACON_JSON_API_BASE BEACON_JSON_WS_URL BEACON_JSON_MAP_CENTER
export BEACON_JSON_MAP_ZOOM BEACON_JSON_DISABLED_TABS BEACON_JSON_ENABLED_THEMES
export BEACON_JSON_APP_NAME BEACON_JSON_SKIP_SPLASH

# Replace complete sentinel string literals with JSON string literals. Vite's
# output may use double quotes, single quotes, or template literals depending
# on minification; handling the delimiters prevents template-literal syntax
# from becoming part of the generated value.
BEACON_AWK_PROGRAM='
function rewrite(text, result, best_position, best_length, best_value, position, candidate, i, quote_index, quote) {
  result = ""
  while (length(text) > 0) {
    best_position = 0
    best_length = 0
    best_value = ""

    for (i = 1; i <= marker_count; i++) {
      for (quote_index = 1; quote_index <= 3; quote_index++) {
        if (quote_index == 1) quote = double_quote
        else if (quote_index == 2) quote = single_quote
        else quote = backtick

        candidate = quote marker[i] quote
        position = index(text, candidate)
        if (position > 0 && (best_position == 0 || position < best_position)) {
          best_position = position
          best_length = length(candidate)
          best_value = replacement[i]
        }
      }
    }

    if (best_position == 0) {
      result = result text
      break
    }
    result = result substr(text, 1, best_position - 1) best_value
    text = substr(text, best_position + best_length)
  }
  return result
}
BEGIN {
  double_quote = sprintf("%c", 34)
  single_quote = sprintf("%c", 39)
  backtick = sprintf("%c", 96)
  marker_count = 8
  marker[1] = "__VITE_API_BASE__"
  marker[2] = "__VITE_WS_URL__"
  marker[3] = "__VITE_MAP_CENTER__"
  marker[4] = "__VITE_MAP_ZOOM__"
  marker[5] = "__VITE_DISABLED_TABS__"
  marker[6] = "__VITE_ENABLED_THEMES__"
  marker[7] = "__VITE_APP_NAME__"
  marker[8] = "__VITE_SKIP_SPLASH__"
  replacement[1] = ENVIRON["BEACON_JSON_API_BASE"]
  replacement[2] = ENVIRON["BEACON_JSON_WS_URL"]
  replacement[3] = ENVIRON["BEACON_JSON_MAP_CENTER"]
  replacement[4] = ENVIRON["BEACON_JSON_MAP_ZOOM"]
  replacement[5] = ENVIRON["BEACON_JSON_DISABLED_TABS"]
  replacement[6] = ENVIRON["BEACON_JSON_ENABLED_THEMES"]
  replacement[7] = ENVIRON["BEACON_JSON_APP_NAME"]
  replacement[8] = ENVIRON["BEACON_JSON_SKIP_SPLASH"]
}
{
  print rewrite($0)
}
'
export BEACON_AWK_PROGRAM

find /srv -type f -name '*.js' -exec sh -c '
  set -eu
  for file do
    temporary=$(mktemp "${file}.beacon-entrypoint.XXXXXX")
    if ! cp -p "$file" "$temporary" || ! awk "$BEACON_AWK_PROGRAM" "$file" > "$temporary"; then
      rm -f "$temporary"
      exit 1
    fi
    mv "$temporary" "$file"
  done
' sh {} +

exec "$@"
