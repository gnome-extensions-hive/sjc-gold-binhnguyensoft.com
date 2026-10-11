# Widget refresh contract tests

Run from the repository root with Node.js 18 or later:

```sh
node --test tests/widget-refresh.test.cjs
```

The suite executes the original `extension.js` module in an isolated VM.
Single-line imports are replaced with blank lines, the default export keyword
is removed, and GNOME adapters are supplied as controlled doubles. It creates
widgets from the original prototype without invoking `_init` or building UI.
No network, subprocess, dependency installation or GNOME session is required.

The claimed boundary is `SjcGoldWidget._refresh`, `_scheduleNextRefresh`,
`_scheduleAfterFailure`, `_showError` and `destroy`, including `validateData`
as called by refresh. Rendering is replaced with a recording double: these
tests verify orchestration, not `_renderData` or live displayed-price accuracy.
The existing undefined `formatDecimal` reference in `_renderData` is not fixed
or hidden by a production change. Successful orchestration tests do not imply
that real rendering succeeds. `SafeCommandRunner`, preference bindings,
position allocation and UI initialization are separate test boundaries.

Generate raw V8 function/block coverage with a fresh output directory:

```sh
coverage_dir=$(mktemp -d)
NODE_V8_COVERAGE="$coverage_dir" node --test tests/widget-refresh.test.cjs
printf 'revision: '; git rev-parse HEAD
printf 'raw V8 coverage: %s\n' "$coverage_dir"
```

Coverage JSON identifies the evaluated script by its absolute `extension.js`
path. Import removal preserves line numbering, but removal of the export
keyword changes character offsets. Interpret offsets against the adapted
source generated at the top of the test file, not the unchanged source.
This is unit-level evidence using mocks, not GNOME integration/end-to-end
coverage or an unchanged-module line percentage. The base repository defines
no integration/end-to-end coverage command or CI artifact mechanism; without
compatible data from the same revision there is nothing to merge.
