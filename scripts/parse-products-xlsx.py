#!/usr/bin/env python3
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("import_xlsx", ROOT / "import-xlsx.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def sheet_rows(sheets, *names):
    for name in names:
        rows = sheets.get(name)
        if rows:
            return rows
    return []


def main():
    data = sys.stdin.buffer.read()
    if not data:
        print(json.dumps({"ok": False, "error": "Boş dosya"}))
        sys.exit(1)

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as handle:
            handle.write(data)
            temp_path = Path(handle.name)

        sheets = MODULE.read_workbook(temp_path)
        products_rows = sheet_rows(sheets, "Products")
        costs_rows = sheet_rows(sheets, "Maliyet Giris", "Maliyet Girişi", "Maliyet Girisi")

        if not products_rows:
            print(json.dumps({"ok": False, "error": "Products sekmesi bulunamadı."}))
            sys.exit(1)

        payload = {
            "ok": True,
            "products": MODULE.map_products(products_rows),
            "costs": MODULE.map_costs(costs_rows),
            "buyboxSnapshots": MODULE.map_buybox_snapshots(products_rows)
        }
        print(json.dumps(payload, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
