#!/usr/bin/env python3
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db.json"
NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Kullanım: python scripts/seed/import-xlsx.py <xlsx-dosya>")

    workbook_path = Path(sys.argv[1]).resolve()
    sheets = read_workbook(workbook_path)
    products_rows = sheets.get("Products", [])
    costs_rows = sheets.get("Maliyet Giris", [])

    if not products_rows:
        raise SystemExit("Products sekmesi bulunamadı.")

    products = map_products(products_rows)
    costs = map_costs(costs_rows)
    buybox_snapshots = map_buybox_snapshots(products_rows)
    profit_snapshots = map_profit_snapshots(sheets.get("BuyBox Karlilik", []))

    db = read_db()
    db["products"] = products
    db["costs"] = costs
    db["buyboxSnapshots"] = merge_snapshots(db.get("buyboxSnapshots", []), buybox_snapshots)
    db["profitSnapshots"] = profit_snapshots
    db["meta"]["updatedAt"] = now()

    DB_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "products": len(products),
        "costs": len(costs),
        "buyboxSnapshotsImported": len(buybox_snapshots),
        "profitSnapshots": len(profit_snapshots),
        "totalSnapshots": len(db["buyboxSnapshots"]),
    }, ensure_ascii=False, indent=2))


def read_workbook(path):
    with zipfile.ZipFile(path) as archive:
        shared_strings = read_shared_strings(archive)
        rels = read_relationships(archive, "xl/_rels/workbook.xml.rels")
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets = {}

        for sheet in workbook.find("a:sheets", NS):
            name = sheet.attrib.get("name", "")
            rel_id = sheet.attrib.get(f"{{{NS['r']}}}id")
            target = rels.get(rel_id)

            if not target:
                continue

            target = str(target or "").lstrip("/")
            if not target.startswith("xl/"):
                target = f"xl/{target}"
            sheets[name] = read_sheet(archive, target, shared_strings)

        return sheets


def read_relationships(archive, rel_path):
    root = ET.fromstring(archive.read(rel_path))
    rels = {}

    for rel in root:
        rels[rel.attrib["Id"]] = rel.attrib["Target"]

    return rels


def read_shared_strings(archive):
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []

    values = []

    for item in root.findall("a:si", NS):
        values.append("".join(text.text or "" for text in item.findall(".//a:t", NS)))

    return values


def read_sheet(archive, path, shared_strings):
    root = ET.fromstring(archive.read(path))
    rows = []

    for row in root.findall(".//a:sheetData/a:row", NS):
        values = []

        for cell in row.findall("a:c", NS):
            ref = cell.attrib.get("r", "A1")
            index = column_index(ref)

            while len(values) <= index:
                values.append("")

            values[index] = read_cell(cell, shared_strings)

        rows.append(values)

    return rows


def read_cell(cell, shared_strings):
    cell_type = cell.attrib.get("t")
    value = cell.find("a:v", NS)

    if cell_type == "s" and value is not None:
        return shared_strings[int(value.text)]

    if cell_type == "inlineStr":
        return "".join(text.text or "" for text in cell.findall(".//a:t", NS))

    if value is None:
        return ""

    return value.text or ""


def column_index(ref):
    letters = re.sub(r"[^A-Z]", "", ref.upper())
    value = 0

    for letter in letters:
        value = value * 26 + ord(letter) - 64

    return value - 1


def map_products(rows):
    headers, data_rows = split_table(rows)
    products = []

    for row in data_rows:
        item = by_header(headers, row)
        barcode = clean_barcode(item.get("Barkod"))

        if not barcode:
            continue

        products.append({
            "barcode": barcode,
            "sku": text(item.get("SKU")),
            "title": text(item.get("Urun adi") or item.get("Ürün adı") or item.get("Ürün Adı")),
            "brand": text(item.get("Marka")),
            "category": text(item.get("Kategori")),
            "salePrice": number_or_blank(item.get("Satis fiyati") or item.get("Satış fiyatı")),
            "listPrice": number_or_blank(item.get("Liste fiyati") or item.get("Liste fiyatı")),
            "stock": number_or_blank(item.get("Stok")),
            "status": text(item.get("Onay durumu")),
            "productUrl": text(item.get("Urun linki") or item.get("Ürün linki")),
            "contentId": text(item.get("Content ID")),
            "productMainId": text(item.get("Product Main ID")),
            "variantId": text(item.get("Variant ID")),
            "commissionRate": number_or_blank(item.get("Komisyon orani %") or item.get("Komisyon oranı %")),
            "updatedAt": now(),
        })

    return products


def map_costs(rows):
    if not rows:
        return []

    headers, data_rows = split_table(rows)
    costs = []

    for row in data_rows:
        item = by_header(headers, row)
        barcode = clean_barcode(item.get("Barkod"))

        if not barcode:
            continue

        costs.append({
            "barcode": barcode,
            "productCost": number_or_blank(item.get("Ürün Maliyeti (KDV Dahil)") or item.get("Ürün Maliyeti ( KDV Dahil)")),
            "desi": number_or_blank(item.get("Ürün Desisi")),
            "commissionRate": "",
            "note": text(item.get("Not")),
            "updatedAt": now(),
        })

    return costs


def map_buybox_snapshots(rows):
    headers, data_rows = split_table(rows)
    snapshots = []

    for row in data_rows:
        item = by_header(headers, row)
        barcode = clean_barcode(item.get("Barkod"))
        buybox_price = number_or_blank(item.get("Buybox fiyati") or item.get("BuyBox Fiyatı"))

        if not barcode or buybox_price == "":
            continue

        snapshots.append({
            "barcode": barcode,
            "buyboxOrder": number_or_blank(item.get("Buybox sirasi")),
            "buyboxPrice": buybox_price,
            "secondBuyboxPrice": number_or_blank(item.get("2. Buybox fiyati")),
            "thirdBuyboxPrice": number_or_blank(item.get("3. Buybox fiyati")),
            "hasMultipleSeller": item.get("Coklu satici var mi"),
            "updatedAt": now(),
        })

    return snapshots


def map_profit_snapshots(rows):
    if not rows:
        return []

    headers, data_rows = split_table(rows)
    snapshots = []

    for row in data_rows:
        item = by_header(headers, row)
        barcode = clean_barcode(item.get("Barkod"))

        if not barcode:
            continue

        snapshots.append({
            "barcode": barcode,
            "brand": text(item.get("Marka")),
            "title": text(item.get("Ürün Adı") or item.get("Urun adi")),
            "buyboxPrice": number_or_blank(item.get("BuyBox Fiyatı") or item.get("Buybox fiyati")),
            "commission": number_or_blank(item.get("Komisyon")),
            "shippingFee": number_or_blank(item.get("Kargo Ücreti")),
            "productCost": number_or_blank(item.get("Ürün Maliyeti")),
            "serviceFee": number_or_blank(item.get("Hizmet Bedeli")),
            "withholding": number_or_blank(item.get("Stopaj Kesintisi")),
            "payableVat": number_or_blank(item.get("Ödenecek KDV")),
            "netProfit": number_or_blank(item.get("Net Kâr / Zarar")),
            "profitRate": number_or_blank(item.get("Kâr Oranı %")),
            "status": normalize_status(item.get("Durum")),
            "missingCommission": text(item.get("Eksik Komisyon")),
            "desi": number_or_blank(item.get("Ürün Desisi")),
            "missingCost": text(item.get("Eksik Maliyet")),
            "missingDesi": text(item.get("Eksik Desi")),
            "minimumSalePrice": number_or_blank(item.get("Min. Satış Fiyatı")),
            "buyboxDifference": number_or_blank(item.get("BuyBox Farkı")),
            "riskLevel": text(item.get("Risk Seviyesi")),
            "recommendedAction": text(item.get("Önerilen Aksiyon")),
            "updatedAt": now(),
        })

    return snapshots


def find_header_row(rows, marker="Barkod"):
    for index, row in enumerate(rows):
        if any(text(cell) == marker for cell in row):
            return index, [text(value) for value in row]
    return None, []


def split_table(rows):
    header_index, headers = find_header_row(rows)
    if header_index is None:
        headers = [text(value) for value in (rows[0] if rows else [])]
        return headers, rows[1:]
    return headers, rows[header_index + 1:]


def map_urunler_settings(rows):
    header_index, headers = find_header_row(rows)
    if header_index is None:
        return [], []

    products = []
    costs = []
    data_rows = rows[header_index + 1:]

    for row in data_rows:
        item = by_header(headers, row)
        barcode = clean_barcode(item.get("Barkod"))
        if not barcode:
            continue

        products.append({
            "barcode": barcode,
            "sku": text(item.get("Stok kodu") or item.get("Stok Kodu")),
            "title": text(item.get("Ürün Adı") or item.get("Urun adi")),
            "brand": "",
            "category": text(item.get("Kategori İsmi") or item.get("Kategori")),
            "salePrice": number_or_blank(item.get("Trendyol  Satış Fiyatı") or item.get("Trendyol Satış Fiyatı")),
            "listPrice": "",
            "stock": number_or_blank(item.get("Stok")),
            "status": "",
            "productUrl": "",
            "contentId": "",
            "productMainId": text(item.get("Model Kodu")),
            "variantId": "",
            "commissionRate": "",
            "updatedAt": now(),
        })

        costs.append({
            "barcode": barcode,
            "productCost": number_or_blank(
                item.get("Ürün Maliyeti (KDV Dahil)")
                or item.get("Ürün Maliyeti ( KDV Dahil)")
            ),
            "desi": number_or_blank(item.get("Ürün Desisi")),
            "commissionRate": "",
            "note": "",
            "modelCode": text(item.get("Model Kodu")),
            "updatedAt": now(),
        })

    return products, costs


def by_header(headers, row):
    item = {}

    for index, header in enumerate(headers):
        if header:
            item[header] = row[index] if index < len(row) else ""

    return item


def merge_snapshots(existing, incoming):
    merged = list(existing)
    keys = {snapshot_key(item) for item in merged}

    for item in incoming:
        key = snapshot_key(item)

        if key not in keys:
            merged.append(item)
            keys.add(key)

    return merged


def snapshot_key(item):
    return "|".join([
        text(item.get("barcode")),
        text(item.get("buyboxPrice")),
        text(item.get("buyboxOrder")),
        text(item.get("secondBuyboxPrice")),
        text(item.get("thirdBuyboxPrice")),
        text(item.get("updatedAt")),
    ])


def clean_barcode(value):
    value = text(value)

    if not value:
        return ""

    try:
        number = float(value)

        if number.is_integer():
            return str(int(number))
    except ValueError:
        pass

    return value


def number_or_blank(value):
    value = text(value)

    if value == "":
        return ""

    normalized = value.replace("₺", "").replace("%", "").strip()

    if "," in normalized and "." in normalized:
        normalized = normalized.replace(".", "").replace(",", ".")
    elif "," in normalized:
        normalized = normalized.replace(",", ".")

    try:
        number = float(normalized)
    except ValueError:
        return ""

    return int(number) if number.is_integer() else number


def normalize_status(value):
    value = text(value).upper()

    if value in ("KÂRLI", "KARLI"):
        return "KARLI"

    if value in ("EKSİK VERİ", "EKSIK VERI", "EKSIK_VERI"):
        return "EKSIK_VERI"

    return value


def text(value):
    if value is None:
        return ""

    return str(value).strip()


def read_db():
    if DB_PATH.exists():
        return json.loads(DB_PATH.read_text(encoding="utf-8"))

    return {
        "products": [],
        "costs": [],
        "commissionRules": [],
        "buyboxSnapshots": [],
        "profitSnapshots": [],
        "alerts": [],
        "meta": {
            "createdAt": now(),
            "updatedAt": now(),
        },
    }


def now():
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    main()
