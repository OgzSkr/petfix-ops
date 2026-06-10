#!/usr/bin/env python3
import json
import sys
from io import BytesIO

try:
    import openpyxl
except ImportError:
    print(json.dumps({"ok": False, "error": "openpyxl gerekli: pip install openpyxl"}))
    sys.exit(1)


def main():
    data = sys.stdin.buffer.read()
    if not data:
        print(json.dumps({"ok": False, "error": "Boş dosya"}))
        sys.exit(1)

    workbook = openpyxl.load_workbook(BytesIO(data), data_only=True)
    sheet = workbook.active
    rows = []

    for row in sheet.iter_rows(values_only=True):
        rows.append(["" if cell is None else cell for cell in row])

    print(json.dumps({"ok": True, "rows": rows}, ensure_ascii=False))


if __name__ == "__main__":
    main()
