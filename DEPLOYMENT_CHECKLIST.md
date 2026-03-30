# Deployment Checklist

## Environment Setup
1. Install Node.js (LTS).
2. Backend dependencies:
   - `cd backend`
   - `npm install`
3. Seed catalog (once per environment):
   - `npm run seed`

## Required Environment Variables (Backend)
Set these in your hosting provider's secret manager (do not commit `.env`):
- `MONGO_URI`
- `JWT_SECRET` (long random string)
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `APP_BASE_URL` (your frontend domain, e.g. `https://yourdomain.com`)
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `RAZORPAY_KEY_ID` (optional if using Pay on Delivery)
- `RAZORPAY_KEY_SECRET` (optional if using Pay on Delivery)

## Build & Run (Backend)
1. `cd backend`
2. `npm start`
3. Verify health:
   - `GET /api/health`

## Frontend Hosting
This frontend is static (HTML/CSS/JS). You can host the `frontend` folder on any static host:
- Upload `frontend` to your static host.
- Ensure the backend URL is reachable from the frontend domain.

## Staging Verification (Manual)
Use a staging environment before production and run through:
1. Home → Products → Product detail page (images load, stock chip visible).
2. Add to cart, update quantity, remove items.
3. Checkout with **Pay on Delivery** (order created, cart cleared).
4. Checkout with **Razorpay** (if keys set) and confirm order is created.
5. User signup → login → profile page (order history shows your order).
6. Change password in profile (works and re-login succeeds).
7. Admin login → Admin dashboard:
   - Orders list shows the placed order.
   - Update order status (e.g., processing → shipped).
8. Contact form submit and admin replies (email should send if SMTP is configured).
9. Forgot password flow (email should send if SMTP is configured).

## Security & Operations
- Confirm HTTPS is enabled on your domain.
- Verify admin credentials are strong and unique.
- Confirm only the intended domain is used for `APP_BASE_URL`.
- Monitor logs and enable backups for MongoDB.

