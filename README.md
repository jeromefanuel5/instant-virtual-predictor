# INSTANT VIRTUAL PREDICTOR — COMPLETE BUILD

This package is a complete runnable build for the requested workflow.

## Included
- Blue responsive UI
- User registration/login
- Free admin account
- User subscription set to TSh 20,000 by default
- Admin-configurable payment method/number/name/instructions
- Payment reference submission and admin approval
- Screenshot upload
- Browser OCR
- Optional AI vision fixture extraction when OPENAI_API_KEY is configured
- Prediction engine that explicitly ignores odds
- Historical-result based analysis
- Prediction records are stored before results
- Admin WIN/LOSS/PENDING verification
- User prediction history
- Local JSON persistence

## Start locally
Install Node.js 18+.

1. Copy `.env.example` to `.env` and fill in values.
2. Set ADMIN_EMAIL and ADMIN_PASSWORD.
3. Run:
   `node server.js`
4. Open:
   `http://localhost:3000`

No npm package is required for the core server. OCR and AI vision use browser/CDN/API when configured.

## Payments
The default mode is manual mobile-money verification:
- Admin enters their own payment number/name in Admin > Settings.
- User sees TSh 20,000 and the payment instructions.
- User submits transaction reference.
- Admin verifies the payment.
- User becomes ACTIVE for the configured number of days.

For automatic payment, connect a Tanzania payment gateway and its webhook. Pesapal provides a Tanzania API for custom websites and supports mobile-money/cards; its official developer documentation provides sandbox/live API environments. Selcom also provides e-commerce APIs in Tanzania. Do not put gateway secrets in frontend code.

## AI
If OPENAI_API_KEY is set, screenshot data is also sent to the configured OpenAI model for fixture extraction. Keep the key on the server only.

## Prediction reality
The prediction engine does NOT use odds. It uses stored historical results and an empirical model. For virtual/instant games, if the underlying game outcome is generated randomly or by an inaccessible algorithm, no AI can guarantee the future outcome. The app therefore stores every prediction before the result and keeps the later WIN/LOSS status immutable in the history.

## Production checklist
- Use HTTPS.
- Move DB from JSON to PostgreSQL/Supabase.
- Add CSRF protection, rate limiting, password reset and audit logs.
- Add real payment-gateway webhook.
- Add a lawful/reliable historical/current data provider.
- Add backups and monitoring.
