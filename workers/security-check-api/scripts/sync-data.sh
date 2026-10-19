#!/usr/bin/env bash
# Regenerates src/quiz-data.json from the single copy file _data/security_check.yml.
# Run after every copy edit. CI-safe: needs only ruby (already used for Jekyll).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
ruby -ryaml -rjson -e 'puts JSON.pretty_generate(YAML.load_file(ARGV[0]))' "$here/../../_data/security_check.yml" > "$here/src/quiz-data.json"
echo "synced $(wc -c < "$here/src/quiz-data.json") bytes -> src/quiz-data.json"
