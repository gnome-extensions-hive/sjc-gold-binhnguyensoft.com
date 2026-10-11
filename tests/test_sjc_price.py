import contextlib
import importlib.util
import io
import json
from pathlib import Path
import runpy
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET


SOURCE = Path(__file__).resolve().parents[1] / "sjc_price.py"


def load_price_module():
    spec = importlib.util.spec_from_file_location("sjc_price_under_test", SOURCE)
    module = importlib.util.module_from_spec(spec)
    # Import the real script without creating a curl session or requiring curl_cffi.
    with patch.dict("sys.modules", {"curl_cffi": SimpleNamespace(requests=Mock())}):
        spec.loader.exec_module(module)
    return module


class PriceTests(unittest.TestCase):
    def setUp(self):
        self.price = load_price_module()

    def sjc_body(self, **overrides):
        data = {
            "success": True,
            "data": [
                {"TypeName": "Other gold", "BuyValue": 100, "SellValue": 200},
                {
                    "TypeName": "Gold SJC 1L",
                    "BuyValue": 170000000,
                    "SellValue": 173000000,
                },
            ],
        }
        data.update(overrides)
        return json.dumps(data)

    def test_sjc_selects_one_luong_and_preserves_prices(self):
        self.assertEqual(
            self.price.parse_sjc(self.sjc_body()),
            {"name": "Gold SJC 1L", "buy": 170000000, "sell": 173000000},
        )

    def test_sjc_accepts_whitespace_and_bom(self):
        self.assertEqual(
            self.price.parse_sjc(" \n\ufeff" + self.sjc_body() + "\n")["sell"],
            173000000,
        )

    def test_sjc_selection_is_case_insensitive_and_uses_first_match(self):
        first = {"name": "SJC 1L first", "buy": 1, "sell": 2}
        second = {"name": "sjc 1l second", "buy": 3, "sell": 4}
        self.assertIs(self.price.select_sjc_1l([first, second]), first)
        self.assertIsNone(self.price.select_sjc_1l([]))

    def test_sjc_rejects_unsuccessful_or_missing_product(self):
        for body in (
            self.sjc_body(success=False),
            self.sjc_body(data=[]),
            self.sjc_body(data=[{"TypeName": "Other", "BuyValue": 1, "SellValue": 2}]),
        ):
            with self.subTest(body=body), self.assertRaises(ValueError):
                self.price.parse_sjc(body)

    def test_sjc_rejects_invalid_json_and_missing_fields(self):
        with self.assertRaises(json.JSONDecodeError):
            self.price.parse_sjc("not JSON")
        for body in ('{}', self.sjc_body(data=[{"TypeName": "SJC 1L"}])):
            with self.subTest(body=body), self.assertRaises(KeyError):
                self.price.parse_sjc(body)

    def test_usd_sell_selects_usd_and_removes_grouping(self):
        body = (
            ' \n\ufeff<ExrateList>'
            '<Exrate CurrencyCode="EUR" Sell="30,000"/>'
            '<Exrate CurrencyCode="USD" Buy="25,000" Sell="26,123.50"/>'
            '</ExrateList>\n'
        )
        self.assertEqual(self.price.parse_vcb_usd_sell(body), 26123.5)

    def test_usd_sell_rejects_missing_or_nonpositive_rate(self):
        for body in (
            '<ExrateList/>',
            '<ExrateList><Exrate CurrencyCode="EUR" Sell="1"/></ExrateList>',
            '<ExrateList><Exrate CurrencyCode="USD" Sell="0"/></ExrateList>',
            '<ExrateList><Exrate CurrencyCode="USD" Sell="-1"/></ExrateList>',
            '<ExrateList><Exrate CurrencyCode="USD" Sell="NaN"/></ExrateList>',
            '<ExrateList><Exrate CurrencyCode="USD" Sell="invalid"/></ExrateList>',
        ):
            with self.subTest(body=body), self.assertRaises(ValueError):
                self.price.parse_vcb_usd_sell(body)

    def test_usd_sell_rejects_malformed_xml_and_missing_sell(self):
        with self.assertRaises(ET.ParseError):
            self.price.parse_vcb_usd_sell("<ExrateList>")
        with self.assertRaises(KeyError):
            self.price.parse_vcb_usd_sell(
                '<ExrateList><Exrate CurrencyCode="USD"/></ExrateList>'
            )

    def test_spot_accepts_numeric_and_string_prices_with_bom(self):
        for value in (2500.5, "2500.5"):
            with self.subTest(value=value):
                body = " \n\ufeff" + json.dumps({"spot_usd_oz": value}) + "\n"
                self.assertEqual(self.price.parse_spot_usd_oz(body), 2500.5)

    def test_spot_rejects_nonpositive_or_invalid_prices(self):
        for value in (0, -1, "NaN", "invalid"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.price.parse_spot_usd_oz(json.dumps({"spot_usd_oz": value}))
        with self.assertRaises(KeyError):
            self.price.parse_spot_usd_oz("{}")
        with self.assertRaises(json.JSONDecodeError):
            self.price.parse_spot_usd_oz("not JSON")

    def test_browser_get_merges_headers_without_mutating_defaults(self):
        session = Mock()
        response = session.get.return_value
        headers = {"Accept": "application/json", "Cache-Control": "custom"}
        defaults = self.price.BROWSER_HEADERS.copy()
        with patch.object(self.price, "SESSION", session):
            self.assertIs(self.price.browser_get("feed", headers), response)
        session.get.assert_called_once_with(
            "feed",
            headers={**defaults, **headers},
            impersonate="chrome",
            timeout=10,
            allow_redirects=True,
        )
        response.raise_for_status.assert_called_once_with()
        self.assertEqual(self.price.BROWSER_HEADERS, defaults)
        self.assertEqual(headers, {"Accept": "application/json", "Cache-Control": "custom"})

    def test_browser_get_without_extra_headers(self):
        session = Mock()
        with patch.object(self.price, "SESSION", session):
            self.price.browser_get("feed")
        self.assertEqual(
            session.get.call_args.kwargs["headers"], self.price.BROWSER_HEADERS
        )

    def test_browser_get_propagates_transport_and_status_errors(self):
        for stage in ("transport", "status"):
            with self.subTest(stage=stage):
                session = Mock()
                error = RuntimeError(stage)
                if stage == "transport":
                    session.get.side_effect = error
                else:
                    session.get.return_value.raise_for_status.side_effect = error
                with patch.object(self.price, "SESSION", session):
                    with self.assertRaises(RuntimeError) as raised:
                        self.price.browser_get("feed")
                self.assertIs(raised.exception, error)

    def test_feed_getters_use_the_expected_url_headers_and_parser(self):
        cases = (
            ("get_sjc_price", self.price.JSC_URL, "parse_sjc", "application/json"),
            ("get_vcb_usd_sell", self.price.VCB_URL, "parse_vcb_usd_sell", "application/xml"),
            ("get_spot_usd_oz", self.price.SPOT_URL, "parse_spot_usd_oz", "application/json"),
        )
        for getter, url, parser, accept in cases:
            with self.subTest(getter=getter):
                expected = object()
                with patch.object(self.price, "browser_get", return_value=SimpleNamespace(text="body")) as get:
                    with patch.object(self.price, parser, return_value=expected) as parse:
                        self.assertIs(getattr(self.price, getter)(), expected)
                get.assert_called_once()
                self.assertEqual(get.call_args.args[0], url)
                self.assertIn(accept, get.call_args.args[1]["Accept"])
                parse.assert_called_once_with("body")

    def test_international_conversion_and_signed_premium(self):
        for sell in (173000000, 1000000):
            with self.subTest(sell=sell):
                result = {"name": "SJC 1L", "buy": 170000000, "sell": sell}
                with patch.object(self.price, "get_spot_usd_oz", return_value=2500):
                    with patch.object(self.price, "get_vcb_usd_sell", return_value=26000):
                        self.assertIs(self.price.add_international_data(result), result)
                converted = 2500 * 26000 * 37.5 / 31.1034768
                self.assertAlmostEqual(result["international_vnd_luong"], converted)
                self.assertAlmostEqual(result["premium_sell"], sell - converted)
                self.assertEqual(result["spot_usd_oz"], 2500)
                self.assertEqual(result["usd_vnd_sell"], 26000)
                self.assertIsNone(result["market_error"])
                self.assertEqual(result["buy"], 170000000)
                self.assertEqual(result["sell"], sell)

    def test_partial_market_failures_preserve_sjc_and_available_quote(self):
        for spot_fails, usd_fails in ((True, False), (False, True), (True, True)):
            with self.subTest(spot_fails=spot_fails, usd_fails=usd_fails):
                result = {"buy": 170000000, "sell": 173000000}
                with patch.object(self.price, "get_spot_usd_oz", return_value=2500,
                                  side_effect=RuntimeError("spot failed") if spot_fails else None) as spot:
                    with patch.object(self.price, "get_vcb_usd_sell", return_value=26000,
                                      side_effect=RuntimeError("rate failed") if usd_fails else None) as usd:
                        self.price.add_international_data(result)
                spot.assert_called_once_with()
                usd.assert_called_once_with()
                self.assertEqual(result["spot_usd_oz"], None if spot_fails else 2500)
                self.assertEqual(result["usd_vnd_sell"], None if usd_fails else 26000)
                self.assertIsNone(result["international_vnd_luong"])
                self.assertIsNone(result["premium_sell"])
                errors = []
                if spot_fails:
                    errors.append("XAU/USD: spot failed")
                if usd_fails:
                    errors.append("USD/VND: rate failed")
                self.assertEqual(result["market_error"], " | ".join(errors))
                self.assertEqual(result["buy"], 170000000)
                self.assertEqual(result["sell"], 173000000)

    def test_main_success_outputs_complete_json_and_zero_status(self):
        output = io.StringIO()
        with patch.object(self.price, "get_sjc_price", return_value=self.price.parse_sjc(self.sjc_body())):
            with patch.object(self.price, "get_spot_usd_oz", return_value=2500):
                with patch.object(self.price, "get_vcb_usd_sell", return_value=26000):
                    with contextlib.redirect_stdout(output):
                        status = self.price.main()
        self.assertEqual(status, 0)
        result = json.loads(output.getvalue())
        self.assertEqual(
            set(result),
            {"name", "buy", "sell", "spot_usd_oz", "usd_vnd_sell",
             "international_vnd_luong", "premium_sell", "market_error"},
        )
        self.assertEqual(result["buy"], 170000000)
        self.assertEqual(result["sell"], 173000000)
        self.assertIsNone(result["market_error"])
        self.assertEqual(len(output.getvalue().splitlines()), 1)

    def test_main_partial_market_failure_is_successful_json(self):
        output = io.StringIO()
        with patch.object(self.price, "get_sjc_price", return_value={"buy": 1, "sell": 2}):
            with patch.object(self.price, "get_spot_usd_oz", side_effect=RuntimeError("offline")):
                with patch.object(self.price, "get_vcb_usd_sell", return_value=26000):
                    with contextlib.redirect_stdout(output):
                        status = self.price.main()
        self.assertEqual(status, 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result["sell"], 2)
        self.assertEqual(result["market_error"], "XAU/USD: offline")
        self.assertIsNone(result["international_vnd_luong"])
        self.assertNotIn("error", result)

    def test_main_primary_feed_failure_outputs_error_json_and_nonzero_status(self):
        output = io.StringIO()
        with patch.object(self.price, "get_sjc_price", side_effect=RuntimeError("feed unavailable")):
            with patch.object(self.price, "add_international_data") as international:
                with contextlib.redirect_stdout(output):
                    status = self.price.main()
        self.assertEqual(status, 1)
        result = json.loads(output.getvalue())
        self.assertEqual(set(result), {"error", "buy", "sell"})
        self.assertTrue(result["error"].endswith("feed unavailable"))
        self.assertIsNone(result["buy"])
        self.assertIsNone(result["sell"])
        international.assert_not_called()
        self.assertEqual(len(output.getvalue().splitlines()), 1)

    def test_missing_curl_dependency_outputs_error_json_and_exits(self):
        output = io.StringIO()
        with patch.dict("sys.modules", {"curl_cffi": None}):
            with contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as raised:
                runpy.run_path(str(SOURCE), run_name="__main__")
        self.assertEqual(raised.exception.code, 1)
        result = json.loads(output.getvalue())
        self.assertEqual(set(result), {"error", "buy", "sell"})
        self.assertIn("curl_cffi", result["error"])
        self.assertIsNone(result["buy"])
        self.assertIsNone(result["sell"])

    def test_script_entrypoint_exits_with_json_status(self):
        for feed_fails in (False, True):
            with self.subTest(feed_fails=feed_fails):
                output = io.StringIO()
                session = Mock()
                if feed_fails:
                    session.get.side_effect = RuntimeError("offline")
                else:
                    session.get.side_effect = [
                        Mock(text=self.sjc_body()),
                        Mock(text='{"spot_usd_oz":2500}'),
                        Mock(text='<ExrateList><Exrate CurrencyCode="USD" Sell="26000"/></ExrateList>'),
                    ]
                requests = SimpleNamespace(Session=Mock(return_value=session))
                with patch.dict("sys.modules", {"curl_cffi": SimpleNamespace(requests=requests)}):
                    with contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as raised:
                        runpy.run_path(str(SOURCE), run_name="__main__")
                self.assertEqual(raised.exception.code, 1 if feed_fails else 0)
                result = json.loads(output.getvalue())
                if feed_fails:
                    self.assertTrue(result["error"].endswith("offline"))
                    self.assertIsNone(result["buy"])
                    self.assertIsNone(result["sell"])
                else:
                    self.assertEqual(result["sell"], 173000000)
                    self.assertEqual(result["spot_usd_oz"], 2500)
                    self.assertEqual(result["usd_vnd_sell"], 26000)
                    self.assertIsNone(result["market_error"])
                self.assertEqual(len(output.getvalue().splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
