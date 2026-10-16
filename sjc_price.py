#######################################################
#                                                     #
# Widget giá vàng SJC                                 #
#                                                     #
# Copyright (C) 2026 Binh Nguyen (binhnguyensoft.com) #
#                                                     #
#######################################################

#!/usr/bin/env python3

import json
import math
import sys
import xml.etree.ElementTree as ET

try:
    from curl_cffi import requests
except ImportError:
    print(
        json.dumps(
            {
                "error": (
                    "Chưa cài curl_cffi. Chạy: python3 -m pip install --upgrade curl_cffi"
                ),
                "buy": None,
                "sell": None,
            },
            ensure_ascii=False,
        )
    )
    sys.exit(1)


JSC_URL = "https://sjc.com.vn/GoldPrice/Services/PriceService.ashx"
VCB_URL = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx"
SPOT_URL = "https://xaus.com/api/v1/spot"

SESSION = requests.Session()

BROWSER_HEADERS = {
    "Accept-Language": "vi-VN,vi;q=0.9",
    "Cache-Control": "no-cache",
}

# Giả lập Chrome để gởi request
def browser_get(url, headers=None):
    merged_headers = BROWSER_HEADERS.copy()

    if headers:
        merged_headers.update(headers)

    response = SESSION.get(
        url,
        headers=merged_headers,
        impersonate="chrome",
        timeout=10,
        allow_redirects=True,
    )
    response.raise_for_status()
    return response


# Lấy giá vàng SJC 1L 
def read_sjc_json(value):
    for item in value["data"]:
        yield {
            "name": item["TypeName"],
            "buy": item["BuyValue"],
            "sell": item["SellValue"],
        }


def select_sjc_1l(items):
    for item in items:
        if "sjc 1l" in item["name"].lower():
            return item
    return None


def parse_sjc(body):
    data = json.loads(body.strip().lstrip("\ufeff"))

    if not data["success"]:
        raise ValueError("Lấy dữ liệu giá SJC thất bại")

    selected = select_sjc_1l(read_sjc_json(data))

    if selected is None:
        raise ValueError("Không tìm thấy vàng SJC 1L trong JSON")

    for key in ("buy", "sell"):
        val = selected[key]
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            raise ValueError(f"Giá {key} không hợp lệ")
        if not (math.isfinite(val) and val > 0):
            raise ValueError(f"Giá {key} không hợp lệ")

    return selected


def get_sjc_price():
    response = browser_get(
        JSC_URL,
        {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Origin": "https://sjc.com.vn",
            "Referer": "https://sjc.com.vn/",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    return parse_sjc(response.text)
    

# Lấy giá bán USD
def parse_vcb_usd_sell(body):
    root = ET.fromstring(body.strip().lstrip("\ufeff"))
    item = root.find("./Exrate[@CurrencyCode='USD']")

    if item is not None:
        try:
            rate = float(item.attrib["Sell"].replace(",", ""))
        except (ValueError, KeyError):
            raise ValueError("Không tìm thấy tỷ giá bán USD")
        if math.isfinite(rate) and rate > 0:
            return rate

    raise ValueError("Không tìm thấy tỷ giá bán USD")


def get_vcb_usd_sell():
    response = browser_get(
        VCB_URL,
        {
            "Accept": "application/xml,text/xml,*/*"
        },
    )

    return parse_vcb_usd_sell(response.text)
        
        
# Lấy giá vàng spot quốc tế
def parse_spot_usd_oz(body):
    data = json.loads(body.strip().lstrip("\ufeff"))
    val = data["spot_usd_oz"]
    if isinstance(val, bool) or not isinstance(val, (int, float, str)):
        raise ValueError("Giá vàng spot không hợp lệ")

    try:
        price = float(val)
    except (ValueError, TypeError):
        raise ValueError("Giá vàng spot không hợp lệ")

    if math.isfinite(price) and price > 0:
        return price

    raise ValueError("Giá vàng spot không hợp lệ")


def get_spot_usd_oz():
    response = browser_get(
        SPOT_URL,
        {"Accept": "application/json"},
    )
    return parse_spot_usd_oz(response.text)


# Tổng hợp thông tin bổ sung bên dưới widget
def add_international_data(result):
    market_errors = []
    spot = None
    usd_vnd = None

    try:
        spot = get_spot_usd_oz()
    except Exception as error:
        market_errors.append(f"XAU/USD: {error}")

    try:
        usd_vnd = get_vcb_usd_sell()
    except Exception as error:
        market_errors.append(f"USD/VND: {error}")

    international = None
    premium = None

    if spot is not None and usd_vnd is not None:
        try:
            inter_val = spot * usd_vnd * 37.5 / 31.1034768
            if not math.isfinite(inter_val):
                raise OverflowError("Derived international price overflow")
            prem_val = result["sell"] - inter_val
            if not math.isfinite(prem_val):
                raise OverflowError("Derived premium price overflow")
            international = inter_val
            premium = prem_val
        except Exception as error:
            market_errors.append(f"Calculation: {error}")
            international = None
            premium = None

    result.update({
        "spot_usd_oz": spot,
        "usd_vnd_sell": usd_vnd,
        "international_vnd_luong": international,
        "premium_sell": premium,
        "market_error": " | ".join(market_errors) or None,
    })
    return result


def main():
    exit_code = 0

    try:
        result = get_sjc_price()
        result = add_international_data(result)
    except Exception as error:
        result = {
            "error": f"Lấy dữ liệu thất bại: {error}",
            "buy": None,
            "sell": None,
        }
        exit_code = 1

    try:
        encoded = json.dumps(
            result,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
    except Exception as error:
        result = {
            "error": f"Lấy dữ liệu thất bại: {error}",
            "buy": None,
            "sell": None,
        }
        exit_code = 1
        encoded = json.dumps(
            result,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )

    print(encoded)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
