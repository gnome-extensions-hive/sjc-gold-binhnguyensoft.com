# Widget UI construction contracts

Run the dependency-free suite from the repository root with Node.js 18 or
newer:

```sh
node --test tests/ui-construction.test.cjs
```

The tests execute the original `extension.js` bodies of `makeLabel`,
`SjcGoldWidget._buildUi` and `_makeFooterRow` in a fresh VM. Only module
imports and the default-export syntax are removed. Recording St actors,
Clutter/Pango constants and class registration replace GNOME adapters.
No production method bodies are copied or stubbed within the claimed cluster.

Assertions cover child ordering, actor types, styles, translated captions,
initial placeholders, price alignment and ellipsizing, footer value identity,
market rows, hidden errors, helper parameter overrides and instance isolation.
They do not run widget initialization, refresh, formatting, allocation,
settings, subprocesses or extension lifecycle methods. In particular, the
existing undefined `formatDecimal` reference in `_renderData` is neither
fixed nor bypassed to claim rendering success.

Generate raw V8 unit coverage with:

```sh
NODE_V8_COVERAGE=/tmp/sjc-ui-coverage \
    node --test tests/ui-construction.test.cjs
```

The JSON includes the adapted module under its absolute `extension.js` URL.
Removed import lines change source offsets: interpret ranges against the
adapted source, not unchanged-source line numbers. No module-wide coverage
percentage is claimed.

These are structural unit contracts, not GNOME integration/end-to-end tests:
real actor layout, font rendering, accessibility and live desktop behavior
require a GNOME session. No repository-defined integration/end-to-end runner
or coverage artifact is available on the base revision. End-to-end coverage
is unknown, and no compatible raw data can be merged with this unit evidence.
