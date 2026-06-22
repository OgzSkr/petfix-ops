#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print(json.dumps({"ok": False, "error": "pandas gerekli: pip install pandas openpyxl"}))
    sys.exit(1)


def clean_barcode(value):
    text = str(value or "").strip().strip('"').strip("'")
    if text.endswith(".0"):
        text = text[:-2]
    text = re.sub(r"\s+", "", text)
    return text if text and text.lower() != "nan" else ""


def parse_price(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if value != value:
            return None
        return float(value)
    text = str(value).strip().replace(",", ".")
    if not text or text.lower() == "nan":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_vat(value):
    if value is None:
        return 20
    text = str(value).strip()
    if text.lower() == "nan" or text == "":
        return 20
    rate = parse_price(value)
    if rate is None:
        return 20
    if rate == 0:
        return 0
    if 0 < rate <= 1:
        return round(rate * 100)
    return round(rate)


def parse_workbook(path):
    df = pd.read_excel(path, sheet_name=0, header=1)
    required = {"Ürün barkodu", "Alış Fiyatı"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Eksik sütunlar: {', '.join(sorted(missing))}")

    has_title = "Ürün adı" in df.columns
    has_vat = "KDV" in df.columns
    items = {}
    skipped = {"empty_barcode": 0, "invalid_price": 0, "duplicate_row": 0}

    for _, row in df.iterrows():
        barcode = clean_barcode(row.get("Ürün barkodu"))
        if not barcode:
            skipped["empty_barcode"] += 1
            continue

        price = parse_price(row.get("Alış Fiyatı"))
        if price is None or price <= 0:
            skipped["invalid_price"] += 1
            continue

        if barcode in items:
            skipped["duplicate_row"] += 1
            if price > items[barcode]["productCost"]:
                items[barcode]["productCost"] = round(price, 2)
            continue

        items[barcode] = {
            "barcode": barcode,
            "productCost": round(price, 2),
            "costVatRate": parse_vat(row.get("KDV")) if has_vat else 20,
            "title": str(row.get("Ürün adı") or "").strip() if has_title else ""
        }

    return list(items.values()), skipped, len(df)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Kullanım: parse-benimpos-xlsx.py <dosya.xlsx>"}))
        sys.exit(1)

    path = Path(sys.argv[1]).resolve()
    if not path.exists():
        print(json.dumps({"ok": False, "error": f"Dosya bulunamadı: {path}"}))
        sys.exit(1)

    try:
        items, skipped, parsed_rows = parse_workbook(path)
        print(json.dumps({
            "ok": True,
            "source": path.name,
            "parsedRows": parsed_rows,
            "itemCount": len(items),
            "items": items,
            "skipped": skipped
        }, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
