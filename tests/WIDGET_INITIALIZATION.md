# Widget initialization and positioning contract tests

Run from the repository root with Node.js 18 or later:

```sh
node --test tests/widget-initialization.test.cjs
```

The suite executes the original `extension.js` module body in a fresh VM per
test. Single-line imports are replaced with blank lines and the default export
keyword is removed. Controlled GNOME adapters model actor initialization,
settings signals, monitor changes and actor allocation.

The claimed functions are `SjcGoldWidget._init` (including its settings and
monitor callbacks), `vfunc_allocate`, and `SjcGoldExtension.enable/disable`.
Contracts cover initialization order, retained signal IDs, position-only
relayout, duration changes while idle or fetching, clamping to the current
primary monitor, missing monitors, and extension widget ownership on disable
and re-enable, including destruction errors.

`_buildUi`, `_refresh`, and `_scheduleNextRefresh` are recording doubles.
Widget destruction is also replaced when testing extension ownership.
These tests do not exercise UI construction, rendering, timer implementation,
subprocesses, live settings, or GNOME integration. In particular, they do not
validate or fix the existing undefined `formatDecimal` rendering reference.
They require no network, subprocess, package installation or GNOME session.

Generate raw V8 function/block coverage with a fresh directory:

```sh
coverage_dir=$(mktemp -d)
NODE_V8_COVERAGE="$coverage_dir" node --test tests/widget-initialization.test.cjs
printf 'revision: '; git rev-parse HEAD
printf 'raw V8 coverage: %s\n' "$coverage_dir"
```

Coverage JSON identifies the evaluated script by its absolute `extension.js`
path. Import removal preserves line numbering, but removing the export keyword
changes character offsets. Interpret raw offsets against the adapted source
defined at the top of the test file, not the unchanged module. No
unchanged-source line percentage is claimed. The base repository provides no
integration/end-to-end runner or coverage artifact mechanism. End-to-end
coverage is unknown; no compatible raw data is available to merge.
