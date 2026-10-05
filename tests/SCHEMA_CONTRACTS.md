# Source-schema contracts

Run from the repository root with Python 3:

```sh
python3 -m unittest discover -s tests -p 'test_schema_contracts.py' -v
```

The suite uses only the Python standard library. It checks the source XML
schema and its link to `metadata.json`, without importing the extension,
opening a display, changing user settings, or accessing the network.

The contracts preserve the existing schema ID and fixed settings path,
the unique `left`, `top`, and `duration` keys, signed 32-bit integer types,
15-pixel position defaults, the 0-10000 pixel position bounds, the 5-minute
refresh default, and the 5-300 minute refresh bounds. Each default must be
inside its inclusive range, and each key must retain a nonempty summary and
description for preferences.

To record Python test execution using the standard-library trace tool:

```sh
python3 -m trace --count --missing --summary \
  --coverdir /tmp/sjc-schema-trace \
  --module unittest discover -s tests -p 'test_schema_contracts.py'
```

Trace measures executed Python lines, not XML coverage. These tests assert
source data contracts; they do not validate GLib schema compilation, the
tracked `schemas/gschemas.compiled` binary, GSettings persistence or bindings,
or live GNOME behavior. They are not integration or end-to-end coverage.
