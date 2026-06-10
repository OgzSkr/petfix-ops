# Güvenlik notları — BuyBox Platform

## API anahtarları (production öncesi)

Chat ve geliştirme oturumlarında aşağıdaki türde bilgiler paylaşılmış olabilir:

- `PLATFORM_API_TOKEN`
- BenimPOS `API_KEY` / `SECRET_KEY` / `BRANCH_ID`
- Uber Eats Trendyol Go `UBER_EATS_*`
- Trendyol worker kimlik bilgileri

**Production veya paylaşımlı ortama geçmeden önce bu anahtarları rotate edin** (yeni key üret → `.env` güncelle → eski key'i iptal et).

Anahtarlar yalnızca yerel `.env` dosyasında tutulmalı; git'e commit edilmemelidir (`.env.example` şablon kullanın).

## Yedek

Ürün eşleştirme / hybrid mod geçişi öncesi `data/db.json` yedeği alınmış olmalıdır (`data/db.json.bak-*`).

## Hybrid mod — satış güvenliği

`PRODUCT_MATCHING_MODE=hybrid` kâr analizinde eşleştirme önerisi ve uyarı üretir.

BenimPOS satış gönderimi **ayrı katı politika** ile çalışır (`sale-strict-no-legacy-fallback`):

- Yalnızca `manual_confirmed` veya güvenli `auto_matched` satırlar
- `missing_master`, `barcode_conflict`, `review_required`, `pending` → engelli
- Legacy barkod fallback **satışta kapalı**

Gerçek satış yalnızca Uber sipariş detayından manuel onay ile (`confirmed: true`, `dryRun: false`).
