# Scripts

| Script | Durum | Açıklama |
|--------|--------|----------|
| `import-xlsx.py` | **Önerilen** | Google Sheet / Excel export → `data/db.json` |
| `import-sheet-export.js` | Legacy | Eski JSON import yolu; yeni kurulumlarda `import-xlsx.py` kullanın |
| `trim-snapshots.js` | Bakım | BuyBox snapshot geçmişini kısaltır |

```bash
# Veri içe aktarma
python3 scripts/import-xlsx.py data/trendyol-export.xlsx

# Snapshot bakımı
npm run maintain:trim-snapshots
```
