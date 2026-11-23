# HyperX Product Pricelist · Iontech

Dealer pricelist for HyperX gaming peripherals, published with GitHub Pages.

* `index.html` — the whole site (no build step). It carries a built-in copy of the catalog, so it works even if a data file is missing.
* `data/products.json` — catalog: models, variants/SKUs, specs, photos, SRP.
* `data/prices.json` — SRP/DP overrides and hidden models. **Written by the Excel workbook** (Publish to website).
* `data/stock.json` — availability levels per SKU (On hand / Limited / Very limited / Incoming / Out). **Written by the Excel workbook** after the SAP MB52 pull. No quantities are published.

Keys are the base SKU (`727A8AA`, no `#ABA`), or `product-id:Variant` for variants without a SKU.

## Laptops tab

The Laptops tab (and the laptop rows under Last-time-buy) is copied from the **HP Gaming Pricelist**, which another team manages:
https://hp-hyperx-pl.github.io/HP-GM-PRICELIST---October-2026/ (as of Oct 5, 2026). Photos are in `assets/laptops/`.

Product photos in `assets/products/` are transparent cutouts made from the HyperX Photo Showcase folder (white backdrop removed). Any product without a local cutout still loads its photo from row.hyperx.com, and the page removes the white backdrop in the browser as it loads; if the image host ever blocks that, the photo simply shows on its light plate as before.
The "Laptop pricelist" button in the header and the link on the Laptops tab open that site. Its URL lives in
`data/products.json` → `laptopSource.url`; when the laptop team publishes a new month, update the URL there (or ask
for a re-import so the laptop prices refresh too).


## Special Price promo
`data/promo.json` holds the current promo: name, start/end time (Manila time) and the special price per SKU. The site shows the promo bar, the Special Price tab and the SP on cards only between `startsAt` and `endsAt`, and hides all of it automatically once the promo ends. To run the next promo, replace `data/promo.json`.

## Pricelist + Pipes (signed-in pages)
Backend: Google Apps Script web app (`apps-script/Code.gs`, deployed from ilovehyperx67's "HyperX Pricing API" project) reading the private Sheet "HyperX Sales Pricing". All pricing, cost and permission checks run server-side; costs never enter this repo.

| Page | Who |
|---|---|
| `quote.html` | admin, CSO manager, sales, CSA, CSO: logged quotations with price snapshots (Quotes / QuoteLines tabs) |
| `dealer.html` | dealer pages: every SKU inherits Base DP, DealerPrices rows are overrides. Dealer accounts see only their own page, read-only, stock as levels |
| `sales.html` | internal special prices + Limited Qty |
| `admin.html` | users & roles, dealer pages, SAP stock / HP sell-out / rebate uploads, settings, activity |
| `editor.html` | margin rules per category × New/Existing, rounding, overrides |

Roles: admin · csomgr · sales · csa · cso · hplead · dealer (Allowlist tab).
Daily updates happen in admin.html or the Sheet. No GitHub needed. After changing `apps-script/Code.gs`: paste into the Apps Script project, Save, Deploy → Manage deployments → Edit → New version.
