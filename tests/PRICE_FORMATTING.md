# Price formatting contracts

Run from the repository root with Node.js 18 or later and Vietnamese Intl
locale support:

```sh
node --test tests/price-formatting.test.cjs
```

The suite evaluates the original `extension.js` module body in fresh Node VM
contexts with minimal GI/resource definition adapters. Imports and the default
export prefix are replaced with equal-length spaces, preserving source line
numbers and character offsets. Neither formatter is copied or replaced.
Native `Intl.NumberFormat('vi-VN')` supplies locale behavior; no network,
subprocess, GNOME session or external package is needed.

The claimed cluster is only `formatPrice` and `formatSignedPrice`. Contracts
cover grouping, decimal precision, rejection without coercion, finite extreme
values, whole-VND rounding, positive prefixes, negative half ties and signed
zero. Plain prices intentionally retain negative zero, while signed premiums
normalize it.

Rendering, validation, refresh, UI construction, settings and subprocess
lifecycle are not exercised. In particular, these tests do not call or repair
the pre-existing undefined `formatDecimal` reference in `_renderData`, and
passing tests do not establish that the real widget renders successfully.

Generate raw V8 function/block coverage in a fresh directory:

```sh
coverage_dir=$(mktemp -d)
NODE_V8_COVERAGE="$coverage_dir" node --test tests/price-formatting.test.cjs
printf 'revision: '; git rev-parse HEAD
printf 'raw V8 coverage: %s\n' "$coverage_dir"
```

Coverage JSON identifies the adapted module by its absolute `extension.js`
path. Formatter offsets match the original source because adaptation is
length-preserving. Executed module definitions are not evidence of tested
behavior in other functions. This is unit-level function/block evidence, not
a module-wide percentage or GNOME integration/end-to-end coverage.

The base repository documents no integration/end-to-end runner or coverage
artifact mechanism. End-to-end coverage is unknown, not zero. Without
compatible raw evidence from the same revision, no combined unit/end-to-end
coverage is claimed.
