# PetFix Panel - Cursor'a Verilecek Ilk Duzeltme Dokumani

Tarih: 10 Haziran 2026

Bu dokuman, PetFix Cok Kanalli Karlilik ve Operasyon Paneli icin ilk duzeltme sprintinde Cursor'a verilecek is listesidir.

Amac yeni ozellik eklemek degil; once panelin gosterdigi rakamlarin dogru, veri katmaninin guvenilir ve operasyon ekranlarinin yaniltmayacak hale gelmesini saglamaktir.

## Cursor Icin Ana Prompt

PetFix Panel projesinde yeni ozellik ekleme. Once mevcut sistemdeki guvenilirlik ve operasyon riski yaratan problemleri duzelt.

Bu sprintin hedefi:

1. Dashboard'daki eslestirme sayaclarini gercek Gelen Kutusu verisiyle ayni hale getirmek.
2. SQLite / JSON parity sorununu cozumlemek veya gecici olarak tek okuma kaynagini netlestirmek.
3. `/api/admin/channel-status` endpoint'indeki 500 hatasini duzeltmek.
4. Kanal status bilgilerini tek kaynaktan uretmek.
5. Karlilik rakamlarina guven etiketi eklemek.
6. Cift para sembolu gibi UI'da yaniltici gorunen hatalari duzeltmek.
7. Bu duzeltmeler icin regression test eklemek.

Kapsam disi:

- Yeni kanal entegrasyonu ekleme.
- ERP, cari hesap, fatura, muhasebe veya stok hareketi modulu yazma.
- Mevcut JSON verisini manuel temizleme.
- Migration calistirma, eger oncesinde ayrica onaylanmadiysa.
- BenimPOS'a gercek satis gonderme.
- Kanal API'lerine gercek stok/fiyat/siparis durumu yazma.

## Kritik Bulgular

### 1. Dashboard eslestirme sayaci yanlis

Problem:

Dashboard ust KPI alaninda "Eslesmemis urun 0" gorunuyor. Ancak Urun Merkezi > Gelen Kutusu ekraninda `2758` kanal urunu karar bekliyor.

Kullaniciya etkisi:

Isletme sahibi eslestirme kuyrugu temiz sanabilir. Bu durum yanlis maliyet, yanlis kar ve BenimPOS aktarim riski yaratir.

Teknik sebep:

`buildMatchingQueue` yalnizca `missing_master`, `review_required`, `pending`, `barcode_conflict` ve `auto_matched` gibi mapping status'lerini sayiyor. Hic mapping kaydi olmayan `unmapped` kanal urunleri dashboard kuyruguna girmiyor.

Etkilenecek dosyalar:

- `lib/product-matching/matching-queue.js`
- `lib/platform/services/action-center.js`
- `public/assets/general-dashboard.js`

Onerilen cozum:

Dashboard ve Action Center eslestirme kuyruğu hesabina su metrikleri ekle:

- toplam kanal urunu
- onayli eslestirme
- unmapped kanal urunu
- kontrol gereken
- toplu onaylanabilir

Kabul kriteri:

Dashboard, Urun Merkezi > Gelen Kutusu ile ayni bekleyen sayiyi gosterir. Mevcut veriyle "Eslesmemis urun 0" yerine yaklasik "Bekleyen 2758" gorunmelidir.

Oncelik: P0
Efor: kucuk / orta

### 2. SQLite / JSON parity bozuk

Problem:

Sistem SQLite read backend ile aciliyor ama parity bozuk oldugu icin JSON fallback kullaniyor.

Canli gozlem:

- JSON products: 464
- SQLite products: 477
- JSON costs: 464
- SQLite costs: 477
- `/api/ops/status` icinde `fallbackActive: true`
- `lastReadError: parity_mismatch`

Kullaniciya etkisi:

Hangi verinin dogru oldugu belirsiz. Panel bir ekranda SQLite, baska ekranda JSON mantigina gore calisirsa kar/maliyet farklari olusabilir.

Teknik sebep:

Dual-write veya onceki import islemleri JSON ve SQLite tablolarini ayrilanmis. `productMatching` de normalize tablolar yerine ayarlar/blob mantigiyla saklaniyor.

Etkilenecek dosyalar:

- `lib/db/store.js`
- `lib/db/sqlite-store.js`
- `lib/db/parity.js`
- `scripts/check-db-parity.js`

Onerilen cozum:

Once veri guvenligi karari ver:

Secenek A:

- Kisa vadede read backend'i JSON'a sabitle.
- SQLite'i sadece deneysel/kapali tut.

Secenek B:

- JSON ve SQLite arasindaki farklari raporla.
- Eksik/fazla 13 product/cost kaydinin kaynagini bul.
- Tek kaynak secildikten sonra parity'yi yeniden kur.

Bu sprint icin onerilen: Once read backend'i guvenli sekilde JSON'a sabitle, sonra ayri bir migration sprinti planla.

Kabul kriteri:

`/api/ops/status` icinde parity belirsizligi kullaniciya kritik uyari olarak yansir veya fallback tamamen ortadan kalkar. Panel hangi kaynaktan okudugunu net gosterir.

Oncelik: P0
Efor: orta

### 3. `/api/admin/channel-status` 500 hatasi

Problem:

Endpoint 500 donuyor:

`column reference "created_at" is ambiguous`

Kullaniciya etkisi:

Sistem sagligi ve kanal durumu ekrani guvenilir degil. Production'a hazirlik kontrolu yapilamaz.

Teknik sebep:

PostgreSQL sorgusunda join olan tablolar arasinda `created_at` kolonu alias'siz kullaniliyor.

Etkilenecek dosya:

- `lib/platform/services/production-channel-status.js`

Onerilen cozum:

Butun SQL sorgularinda `created_at`, `updated_at`, `status` gibi ortak kolonlari tablo alias'i ile kullan.

Kabul kriteri:

`GET /api/admin/channel-status` 200 donmeli ve her kanal icin son webhook, son siparis, son hata, bekleyen outbox bilgisi okunabilmeli.

Oncelik: P1
Efor: kucuk

### 4. Kanal status bilgileri tutarsiz

Problem:

Kanal registry bazi kanallari active gosteriyor, product matching status ayni kanallari planned gosteriyor.

Ornek:

- `lib/channels/registry.js` icinde Yemeksepeti ve WooCommerce active.
- Product matching status icinde Yemeksepeti / WooCommerce matching kanali planned gorunebiliyor.

Kullaniciya etkisi:

Kullanici bir kanalin hazir mi, sadece siparis mi aliyor, katalog eslestirme mi destekliyor anlayamiyor.

Teknik sebep:

Kanal bilgisi birden fazla yerde tutuluyor.

Etkilenecek dosyalar:

- `lib/channels/registry.js`
- `lib/product-matching/constants.js`
- `lib/platform/services/product-matching.js`
- `lib/panel/nav-config.js`

Onerilen cozum:

Tek kanal registry'si kullan:

- operationalStatus: active / planned / disabled
- ordersSupported
- catalogSupported
- matchingSupported
- liveWriteSupported
- profitSupported

Kabul kriteri:

Dashboard, Urun Merkezi, Ayarlar ve kanal sayfalari ayni status bilgisini gosterir.

Oncelik: P1
Efor: orta

### 5. Karlilik rakamlari guven etiketi olmadan gosteriliyor

Problem:

Eksik maliyet veya legacy fallback olan siparislerde kar rakami gorunebiliyor. Bazi yerlerde veri uyarisi var ama KPI tarafinda yeterince ayrismiyor.

Kullaniciya etkisi:

Yanlis kar gostergesi fiyat, kampanya veya kanal karari aldirtabilir.

Teknik sebep:

Karlilik hesaplari maliyet, komisyon, kargo, KDV ve eslestirme kaynagi farkli guven seviyelerine sahip olmasina ragmen ana KPI'larda tek rakam gibi sunuluyor.

Etkilenecek dosyalar:

- `lib/order-profitability.js`
- `lib/production/profit-confidence.js`
- `lib/platform/services/channel-orders.js`
- `lib/platform/services/channels-summary.js`
- `lib/platform/services/live-performance.js`
- `public/assets/general-dashboard.js`
- `public/assets/channel-page.js`

Onerilen cozum:

Her siparis ve KPI icin kar guven seviyesi kullan:

- reliable
- estimated
- missing_cost
- invalid_data
- legacy_fallback

Ana KPI'lara sadece reliable + kabul edilen estimated kayitlari kat. Eksik maliyetli siparisleri ayri uyarida goster.

Kabul kriteri:

Maliyet eksikse siparis listesinde ve dashboard'da "Kar guvenilir degil" rozeti gorunur. Bu siparis ana net kar KPI'ina dahil edilmez veya ayrica belirtilir.

Oncelik: P1
Efor: orta

### 6. UI'da cift para sembolu var

Problem:

Dashboard canli siparis tablosunda `₺₺200,00` gibi cift sembol gorunuyor.

Teknik sebep:

`formatMoney()` zaten `₺` ekliyor; `renderLiveOrderRow` tekrar `₺` ekliyor.

Etkilenecek dosya:

- `public/assets/general-dashboard.js`

Kabul kriteri:

Tutarlar `₺200,00` formatinda tek sembolle gorunur.

Oncelik: P2
Efor: kucuk

### 7. Mapping audit log kalici degil

Problem:

`mappingLogs` son 500 kayitla sinirli.

Kullaniciya etkisi:

Yanlis eslestirme kim tarafindan, ne zaman, hangi eski degerden hangi yeni degere yapildi geriye donuk izlenemeyebilir.

Teknik sebep:

Audit log JSON blob icinde tutuluyor.

Etkilenecek dosyalar:

- `lib/product-matching/store.js`
- `lib/platform/services/product-matching.js`

Onerilen cozum:

Bu sprintte migration yapma. Ancak kod tarafinda audit event yapisini netlestir:

- action
- actor
- before
- after
- channelId
- channelProductId
- masterProductId
- requestId

Sonraki sprintte `product_mapping_events` tablosuna tasimak icin hazirlik yap.

Kabul kriteri:

Yeni audit event modeli dokumante edilir ve mevcut log yazimlari ayni semantik alanlari kullanir.

Oncelik: P1
Efor: orta

## Test Plani

Bu sprintte en az su testler eklenmeli veya guncellenmeli:

1. Dashboard queue sayaci `unmapped` kanal urunlerini sayar.
2. `buildMatchingQueue` 2777 kanal urunu ve 19 mapping olan durumda bekleyen sayiyi 2758 olarak hesaplar.
3. `/api/admin/channel-status` endpoint'i 200 doner.
4. SQLite parity mismatch oldugunda UI/ops status net uyari verir.
5. `formatMoney` cift `₺` uretmez.
6. Eksik maliyetli siparis `profitConfidence=missing_cost` olarak isaretlenir.
7. Shadow mode kapaliyken bile feature flag kapaliysa kanal yazma dry-run kalir.

## Is Sirasi

### Once

1. Dashboard eslestirme sayaci.
2. Admin channel status 500.
3. Cift para sembolu.
4. Kanal status tek kaynaga yaklastirma.

### Sonra

5. SQLite/JSON parity kararini netlestirme.
6. Kar guven etiketi.
7. Audit event semantigini netlestirme.

### Daha Sonra

8. Product matching verisini normalize tabloya tasima.
9. Outbox retry/dead-letter worker.
10. Kullanici/rol/sube yetkilendirme.

## Kabul Edilecek Sprint Ciktisi

Sprint sonunda su durum saglanmali:

- Dashboard artik yanlis "Eslesmemis urun 0" gostermiyor.
- Urun Merkezi > Gelen Kutusu ile dashboard ayni kuyruk gercegini gosteriyor.
- Sistem sagligi endpoint'i 500 vermiyor.
- SQLite/JSON belirsizligi kullanicidan saklanmiyor.
- Kâr rakamlarinda eksik maliyet / tahmini hesap ayrimi basliyor.
- Mutasyonlu operasyon butonlari daha guvenli ve daha net.
- Yeni ozellik eklenmeden mevcut panel daha guvenilir hale geliyor.

## Cursor'a Kisa Tek Paragraf Prompt

PetFix Panel'de yeni ozellik ekleme; once guvenilirlik duzeltmesi yap. Dashboard'daki "Eslesmemis urun 0" hatasini, Urun Merkezi Gelen Kutusu'ndaki gercek bekleyen kanal urunu sayisiyla hizala. `buildMatchingQueue` icinde mapping kaydi olmayan `unmapped` kanal urunlerini de bekleyen kuyruga dahil et. Ardindan `/api/admin/channel-status` 500 hatasini SQL alias kullanarak duzelt, dashboard'daki `₺₺` cift para sembolunu gider, kanal status bilgisini tek kaynaktan okumaya yaklastir ve eksik maliyetli siparislerde kar rakamina guven etiketi ekle. Migration veya gercek kanal/BenimPOS yazma islemi yapma. Her duzeltme icin regression test ekle.

