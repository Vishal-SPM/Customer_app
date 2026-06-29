# EATs Voucher System — Prototype

## Setup (one time)

```bash
cd prototype
npm install
npm start
```

Server runs at **http://localhost:3000**

---

## Postman Flow — End to End

### Step 1 — Create a Client

```
POST http://localhost:3000/api/clients
Content-Type: application/json

{
  "name": "HDFC Bank",
  "logo_url": "https://upload.wikimedia.org/wikipedia/commons/2/28/HDFC_Bank_Logo.svg"
}
```

**Save:** `id` → your `CLIENT_ID`

---

### Step 2 — Create a Program

```
POST http://localhost:3000/api/programs
Content-Type: application/json

{
  "client_id": "{{CLIENT_ID}}",
  "name": "HDFC Infinia Lounge Access",
  "code_prefix": "HDFC",
  "validity_days": 30,
  "redemption_modes": ["portal", "api"]
}
```

**Save:** `id` → `PROGRAM_ID`, `api_key` → `API_KEY`  
> All voucher creation calls require `x-api-key: {{API_KEY}}` header.

---

### Step 3 — Create Outlets

Repeat for each outlet you want:

```
POST http://localhost:3000/api/outlets
Content-Type: application/json

{
  "name": "Plaza Premium Lounge T3",
  "airport_code": "DEL",
  "terminal": "T3",
  "requires_boarding_pass": false
}
```

```
POST http://localhost:3000/api/outlets
Content-Type: application/json

{
  "name": "GVK Lounge T2",
  "airport_code": "BOM",
  "terminal": "T2",
  "requires_boarding_pass": true
}
```

**Save:** `id` values → `OUTLET_ID_1`, `OUTLET_ID_2`

---

### Step 4 — Map Outlets to Program (with pricing)

```
POST http://localhost:3000/api/programs/{{PROGRAM_ID}}/outlets
Content-Type: application/json

{
  "outlet_id": "{{OUTLET_ID_1}}",
  "price": 850
}
```

```
POST http://localhost:3000/api/programs/{{PROGRAM_ID}}/outlets
Content-Type: application/json

{
  "outlet_id": "{{OUTLET_ID_2}}",
  "price": 950
}
```

---

### Step 5 — Verify Outlets Mapped to Program

```
GET http://localhost:3000/api/programs/{{PROGRAM_ID}}/outlets
```

Returns all outlets mapped to the program with program-specific pricing.

---

### Step 6 — Create a Voucher

```
POST http://localhost:3000/api/vouchers
x-api-key: {{API_KEY}}
Content-Type: application/json

{
  "passenger_name": "Rahul Sharma",
  "pax_count": 2,
  "start_date": "2026-06-26",
  "delivery_method": "download",
  "benefit_scope": {
    "type": "program"
  }
}
```

**benefit_scope options:**

| Type | Payload |
|---|---|
| All program outlets | `{ "type": "program" }` |
| Single outlet | `{ "type": "outlet", "outlet_id": "UUID" }` |
| Airport (all terminals) | `{ "type": "airport", "airport_code": "DEL" }` |
| Airport + terminal | `{ "type": "airport_terminal", "airport_code": "DEL", "terminal": "T3" }` |
| Lounge group | `{ "type": "lounge_group", "lounge_group_id": "UUID" }` |

**Response includes:**
```json
{
  "code": "HDFC-A3K9MP2X",
  "voucher_url": "http://localhost:3000/v/HDFC-A3K9MP2X",
  "eligible_outlets": [...],
  "expiry_date": "2026-07-26",
  ...
}
```

---

### Step 7 — Open the Voucher Link

Open **`http://localhost:3000/v/HDFC-A3K9MP2X`** in any browser.

You'll see a fully rendered voucher card with:
- Client branding / logo
- Passenger name + guest count
- Live QR code (operator scans this)
- Voucher code in large monospace font
- Valid From / Valid Until dates
- List of eligible lounges with terminal and boarding pass requirements
- Status badge (Valid / Redeemed / Expired / Upcoming)

---

## Other Useful Calls

### List vouchers for your program
```
GET http://localhost:3000/api/vouchers
x-api-key: {{API_KEY}}
```

### Get single voucher (JSON)
```
GET http://localhost:3000/api/vouchers/HDFC-A3K9MP2X
x-api-key: {{API_KEY}}
```

### Redeem a voucher (simulates operator scan)
```
POST http://localhost:3000/api/vouchers/HDFC-A3K9MP2X/redeem
x-api-key: {{API_KEY}}
Content-Type: application/json

{
  "outlet_id": "{{OUTLET_ID_1}}",
  "redeemed_by": "operator_001",
  "boarding_pass_number": "6X4821"
}
```

### Void a voucher
```
PATCH http://localhost:3000/api/vouchers/HDFC-A3K9MP2X/void
x-api-key: {{API_KEY}}
```

---

## Error Codes

| HTTP | error | Meaning |
|---|---|---|
| 401 | — | Missing or invalid `x-api-key` |
| 403 | — | Voucher belongs to a different program |
| 404 | — | Resource not found |
| 409 | `ALREADY_REDEEMED` | QR already scanned once |
| 422 | `INVALID_EXPIRED` | Past expiry date |
| 422 | `INVALID_NOT_STARTED` | Before start date |
| 422 | `VOUCHER_VOIDED` | Voided by ops |

---

## Database

SQLite file is created automatically at `data/vouchers.db`.  
To reset everything: delete `data/vouchers.db` and restart.
