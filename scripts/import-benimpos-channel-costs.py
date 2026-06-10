#!/usr/bin/env python3
"""BenimPOS ürün export → Diğer Kanallar maliyetleri (channelCosts)."""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Kullanım: python3 scripts/import-benimpos-channel-costs.py <benimpos.xlsx>")

    try:
        import pandas as pd
    except ImportError as exc:
        raise SystemExit("pandas gerekli: pip install pandas openpyxl") from exc

    workbook_path = Path(sys.argv[1]).resolve()
    if not workbook_path.exists():
        raise SystemExit(f"Dosya bulunamadı: {workbook_path}")

    df = pd.read_excel(workbook_path, sheet_name=0, header=1)
    required = {"Ürün barkodu", "Alış Fiyatı"}
    missing = required - set(df.columns)
    if missing:
        raise SystemExit(f"Eksik sütunlar: {', '.join(sorted(missing))}")

    has_title = "Ürün adı" in df.columns
    has_vat = "KDV" in df.columns

    incoming = {}
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

        if barcode in incoming:
            skipped["duplicate_row"] += 1
            if price > incoming[barcode]["productCost"]:
                incoming[barcode]["productCost"] = price
            continue

        vat_rate = parse_vat(row.get("KDV")) if has_vat else 20
        title = clean_text(row.get("Ürün adı")) if has_title else ""

        incoming[barcode] = {
            "barcode": barcode,
            "productCost": round(price, 2),
            "desi": "",
            "commissionRate": "",
            "costVatRate": vat_rate,
            "modelCode": "",
            "color": "",
            "size": "",
            "returnRate": 0,
            "returnRateLabel": "",
            "deliveryType": "Bugün Kargoda",
            "extraExpense": 0,
            "title": title,
            "note": f"BenimPOS import ({workbook_path.name})",
            "updatedAt": now(),
        }

    db = read_db()
    db.setdefault("channelCosts", [])
    existing_by_barcode = {
        str(item.get("barcode", "")): item for item in db["channelCosts"] if item.get("barcode")
    }

    added = 0
    updated = 0
    for barcode, cost in incoming.items():
        if barcode in existing_by_barcode:
            existing = existing_by_barcode[barcode]
            existing.update({
                "productCost": cost["productCost"],
                "costVatRate": cost.get("costVatRate", existing.get("costVatRate", 20)),
                "title": cost.get("title") or existing.get("title", ""),
                "note": cost["note"],
                "updatedAt": cost["updatedAt"],
            })
            updated += 1
        else:
            db["channelCosts"].append(cost)
            existing_by_barcode[barcode] = cost
            added += 1

    db.setdefault("meta", {})
    db["meta"]["updatedAt"] = now()
    db["meta"]["channelCostsImport"] = {
        "source": workbook_path.name,
        "importedAt": now(),
        "added": added,
        "updated": updated,
        "skipped": skipped,
    }

    DB_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "source": workbook_path.name,
        "parsedRows": len(df),
        "importedCosts": len(incoming),
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "channelCostsTotal": len(db["channelCosts"]),
    }, ensure_ascii=False, indent=2))


def read_db():
    if not DB_PATH.exists():
        return {"products": [], "costs": [], "channelCosts": [], "meta": {}}
    return json.loads(DB_PATH.read_text(encoding="utf-8"))


def clean_barcode(value):
    text = str(value or "").strip().strip('"').strip("'")
    if text.endswith(".0"):
        text = text[:-2]
    text = re.sub(r"\s+", "", text)
    return text if text and text.lower() != "nan" else ""


def clean_text(value):
    text = str(value or "").strip()
    return "" if text.lower() == "nan" else text


def parse_price(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if value != value:  # NaN
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


def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    main()
