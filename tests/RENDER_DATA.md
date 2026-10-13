# Render-data contracts

Run the dependency-free Node suite from the repository root:

```sh
node --test tests/render-data.test.cjs
```

The suite executes the original `extension.js` module in fresh VM contexts.
Import statements and the default-export prefix are replaced with equal-length
spaces, preserving source offsets. Only `SjcGoldWidget._renderData` is called;
widget initialization, UI construction, refresh, allocation, settings,
subprocesses, and preferences are outside this suite.

Plain recording labels stand in for actors. A controlled local clock verifies
the `%H:%M` format request. The actual `formatPrice` and `formatSignedPrice`
helpers remain intact; their exhaustive formatter contracts belong to the
separate price-formatting suite. These tests check routing, spread calculation,
conversion rounding, missing-value replacement, timestamp updates, retained
label identity, and independence between responses and widgets.

**Important limitation:** the production module refers to `formatDecimal` but
does not define it. The harness injects an explicitly recording decimal
dependency to test the remaining label-routing contracts. It does not implement
or validate decimal formatting, repair that production defect, or establish
that an unmodified widget refresh succeeds. Passing these contracts does not
establish real GNOME rendering or end-to-end coverage.

Generate raw V8 unit coverage separately:

```sh
mkdir -p /tmp/sjc-render-data-coverage
NODE_V8_COVERAGE=/tmp/sjc-render-data-coverage \
  node --test tests/render-data.test.cjs
```

Use an empty output directory for each revision. The JSON records identify the
adapted `extension.js` by absolute path and contain `_renderData` function/block
ranges. Equal-length blanking preserves offsets, but the imported environment
is replaced, so these records are not live GNOME execution or a module-wide
production coverage percentage. Only merge compatible raw sources for the same
code revision and environment.

The baseline repository documents no unit, integration, or end-to-end runner.
Its shexli workflow packages and statically reviews the extension; it does not
run these contracts or provide end-to-end coverage. Use standalone commands
above until a unit workflow is landed. End-to-end coverage remains unknown.
