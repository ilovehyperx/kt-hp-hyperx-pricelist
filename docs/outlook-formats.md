# Outlook thread formats (from the KT-HP email threads)

**Reservation:** Subject `RESERVATION: KT-HP (MM/DD/YYYY)`
Columns: CODE | BEGINNING INVENTORY | RESERVED | BALANCE | WAREHOUSE | CLIENT NAME | RESERVED BY | REMARKS
CODE = SAP material description (e.g. `HP HX 872V1AA QUADCAST 2 BK`); warehouse e.g. `BS3`.

**Hold:** Subject `HOLD STOCKS: KT-HP FOR <DEALER> (MM/DD/YYYY)`
Body: "seeking for your approval to hold below stocks until <date>."
Columns: CODE | QTY | REMARKS (e.g. `HP HX A59YZAA CLOUD III S WIRELESS BK` | 20 | CONFIRMATION)
To: sales distribution list · CC: brand manager + PM approvers.
