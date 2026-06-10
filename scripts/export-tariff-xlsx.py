#!/usr/bin/env python3
import json
import sys
from io import BytesIO

try:
    from openpyxl import Workbook
except ImportError:
    sys.stderr.write("openpyxl gerekli: pip install openpyxl\n")
    sys.exit(1)


def main():
    payload = json.load(sys.stdin)
    rows = payload.get("rows") or []
    if not rows:
        sys.stderr.write("Export satırı yok\n")
        sys.exit(1)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Sheet1"

    for row_index, row in enumerate(rows, start=1):
        for col_index, value in enumerate(row, start=1):
            if value == "" or value is None:
                continue
            sheet.cell(row=row_index, column=col_index, value=value)

    buffer = BytesIO()
    workbook.save(buffer)
    sys.stdout.buffer.write(buffer.getvalue())


if __name__ == "__main__":
    main()
