# PDF Generator API

Generate PDFs from a Handlebars template + row data, then download them as a ZIP.

Base path: `/api/v1/pdf`  
Default port: **4008**

## Features

- Firebase ID token authentication (`Authorization: Bearer <token>`)
- Templates: raw string or uploaded `.txt` / `.hbs` / `.html` (Handlebars `{{field}}`)
- Input data: raw JSON, or uploaded `.json` / `.csv` / `.xlsx` / `.xls`
- **Max 10 rows per user request**
- **Max 10 generate jobs per user per hour**
- Response: `application/zip` containing one PDF per row

## Auth

Production / Render:

| Variable | Description |
|----------|-------------|
| `FIREBASE_PROJECT_ID` | Firebase project id |
| `FIREBASE_CLIENT_EMAIL` | Service account email |
| `FIREBASE_PRIVATE_KEY` | Service account private key (`\n` escaped OK) |

Or use `GOOGLE_APPLICATION_CREDENTIALS` / Auth emulator via `FIREBASE_AUTH_EMULATOR_HOST`.

Local tests:

```bash
PDF_GENERATOR_AUTH_MODE=test
```

Then send `Authorization: Bearer test:<uid>`.

## Examples

### JSON body

```bash
curl -X POST http://localhost:4008/api/v1/pdf/generate \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -o invoices.zip \
  -d '{
    "template": "Invoice for {{name}}\nAmount: {{amount}}",
    "data": [
      { "name": "Ada", "amount": "120" },
      { "name": "Lin", "amount": "90" }
    ],
    "fileNamePrefix": "invoice"
  }'
```

### Multipart (CSV + template file)

```bash
curl -X POST http://localhost:4008/api/v1/pdf/generate \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -F "template=@./invoice.hbs" \
  -F "data=@./rows.csv" \
  -o invoices.zip
```

### Limits

```bash
curl http://localhost:4008/api/v1/pdf/limits \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN"
```

## Run

```bash
pnpm --filter @rudra/pdf-generator-api dev
```
