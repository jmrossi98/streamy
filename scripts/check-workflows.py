#!/usr/bin/env python3
"""Fails if any workflow file is not parseable YAML.

GitHub reports an unparseable workflow as a failed run with no logs and the
message "this run likely failed because of a workflow file issue" -- on every
push, for every workflow, until it is fixed. There is nothing in the run to
say which file or which line.

The way it happened here is worth naming, because it is easy to repeat: a
`run: |` block scalar holds its script by indentation, so an embedded
multi-line snippet (a python -c "..." spanning lines, a heredoc) has to stay
indented too. Written at column 0 it silently ends the scalar and corrupts
the rest of the file.

Cheap to check, and the check belongs next to check-deploy-env.mjs: both catch
a broken deployment pipeline that the application's own tests cannot see.
"""
import glob
import sys

try:
    import yaml
except ImportError:  # pragma: no cover - the runner always has it
    print("PyYAML unavailable; skipping workflow syntax check")
    sys.exit(0)

failures = []
paths = sorted(glob.glob(".github/workflows/*.yml") + glob.glob(".github/workflows/*.yaml"))
for path in paths:
    try:
        with open(path, encoding="utf-8") as handle:
            parsed = yaml.safe_load(handle)
    except yaml.YAMLError as err:
        failures.append((path, str(err).replace("\n", " ")))
        continue
    if not isinstance(parsed, dict):
        failures.append((path, "does not parse to a mapping"))
        continue
    if "jobs" not in parsed:
        failures.append((path, "has no `jobs` key"))

for path, why in failures:
    print(f"::error file={path}::{why}")

print(f"checked {len(paths)} workflow files, {len(failures)} broken")
sys.exit(1 if failures else 0)
