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
The "Laptop pricelist" button in the header and the link on the Laptops tab open that site. Its URL lives in
`data/products.json` → `laptopSource.url`; when the laptop team publishes a new month, update the URL there (or ask
for a re-import so the laptop prices refresh too).
