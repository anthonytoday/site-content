#!/usr/bin/env bash
# Re-render assets/img/security-check/maturity-level-{1..4}.png from the maturity block in _data/security_check.yml.
set -euo pipefail
cd "$(dirname "$0")/../../.."
ruby -ryaml -rjson -e 'puts JSON.generate(YAML.load_file("_data/security_check.yml")["maturity"])' > /tmp/maturity.json
node tools/security-check/maturity/render.mjs /tmp/maturity.json assets/img/security-check
