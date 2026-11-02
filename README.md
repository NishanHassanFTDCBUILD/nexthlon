# Nexthlon — Sports E-commerce Marketplace

**Your Next Move Starts Here.**

A sports gear store built with **Node.js, Express, EJS and MongoDB**, using **stateless JWT authentication**.
This is the Week 6 base build: authentication, user profiles, addresses, admin user management, and a simple product catalogue.

## What works

**Customers**
- Sign up and sign in with server-side validation and bcrypt-hashed passwords
- JWT issued on sign-in, stored in an `httpOnly` cookie, and checked on every request
- Signed-in users are sent away from the login and signup pages
- Profile page: update name and mobile number, change password
- Address book: add, edit, delete, and set a default address (up to 10)
- Browse products: categories, keyword search, price filter, in-stock filter, sorting, pages
- Product detail pages with photo gallery, price, M.R.P., stock status and specs

**Admin**
- Separate admin login at `/admin/login`
- Dashboard: customer counts, new sign-ups, blocked users, product counts, low-stock list
- Users page: search, filter by status, block and unblock customers
- Blocking works immediately, because every request checks the account in the database

**Not built yet (next modules):** cart, wishlist, checkout, orders, payments, admin product management.

## Products are simple on purpose

Each product is one item with one price and one stock count. There are no sizes or colours (variants) yet.
This keeps the database simple while the core e-commerce flow is built.

## Requirements

- Node.js 18.18 or newer
- MongoDB running locally, or a MongoDB Atlas connection string

## Setup

1. Install the packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`, then fill it in:
   - `MONGODB_URI`: your database address
   - `JWT_SECRET`: a long random secret. Make one with:

     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```

   - `ADMIN_EMAIL` and `ADMIN_PASSWORD`: the first admin account (password: at least 10 characters with letters and numbers)

3. Add the starter products and the admin account:

   ```bash
   npm run seed:products
   npm run seed:admin
   ```

4. Start the server:

   ```bash
   npm run dev
   ```

5. Open http://localhost:3000. The admin console is at http://localhost:3000/admin/login.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the server and restarts it when files change |
| `npm start` | Starts the server |
| `npm run seed:products` | Adds the 15 starter products (existing ones are left alone) |
| `npm run seed:admin` | Creates the admin from `.env`, or makes that email an admin |
| `npm test` | Runs the tests |

## Folder structure

```
config/        Settings (env, database, fixed lists)
models/        Mongoose schemas: User, Address, Product
routes/        URL maps: authRoutes, profileRoutes, addressRoutes, productRoutes, adminRoutes, pageRoutes
controllers/   Handle each request and send the reply
services/      Business logic: auth, tokens, profile, admin, products
middleware/    JWT check, admin check, CSRF origin check, rate limit, errors
utils/         Validation and small helpers
views/         EJS pages, partials and admin pages
public/        CSS, browser JavaScript and icons
scripts/       Seed scripts
data/          Starter product list
tests/         Unit and API tests
```

## How sign-in works (JWT)

1. The user signs in with `POST /api/login`.
2. The server checks the password with bcrypt.
3. The server signs a JWT containing only the user id, role and a token version.
4. The JWT is stored in an `httpOnly` cookie, so browser JavaScript cannot read it.
5. On every request, `middleware/auth.js` verifies the JWT, then loads the user to check they still exist and are not blocked.
6. Signing out deletes the cookie. Changing the password raises the token version, so older tokens stop working.

No sessions are stored on the server. The token is the proof of login.

API tools such as Postman can send the token as `Authorization: Bearer <token>`. It is returned in the login reply.

## API

| Method | URL | Who | Purpose |
|---|---|---|---|
| POST | `/api/signup` | Public | Create a customer account |
| POST | `/api/login` | Public | Customer sign in |
| POST | `/api/admin/login` | Public | Admin sign in |
| GET | `/api/me` | Signed in | Current user |
| POST | `/api/logout` | Anyone | Sign out |
| POST | `/api/admin/logout` | Admin | Admin sign out |
| GET | `/api/profile` | Customer | View profile |
| PATCH | `/api/profile` | Customer | Update name and phone |
| PATCH | `/api/profile/password` | Customer | Change password |
| GET | `/api/addresses` | Customer | List addresses |
| POST | `/api/addresses` | Customer | Add an address |
| PATCH | `/api/addresses/:addressId` | Customer | Edit an address |
| PATCH | `/api/addresses/:addressId/default` | Customer | Make it the default |
| DELETE | `/api/addresses/:addressId` | Customer | Delete an address |
| GET | `/api/products` | Public | List products with filters |
| GET | `/api/products/search?q=` | Public | Search products |
| GET | `/api/products/:id` | Public | One product, by id or slug |
| GET | `/api/categories` | Public | Categories with counts |
| GET | `/api/admin/dashboard` | Admin | Dashboard numbers |
| GET | `/api/admin/customers` | Admin | List and search customers |
| PATCH | `/api/admin/customers/:userId/block` | Admin | Block or unblock (`{ "isBlocked": true }`) |
| GET | `/api/health` | Public | Health check |

Errors use the right HTTP status (400, 401, 403, 404, 409, 429, 500) and a JSON `message`. Form errors also return an `errors` object with one message per field.

## Security

- Passwords hashed with bcrypt (12 rounds), never returned by the API
- JWT signed with HS256, with issuer, audience and expiry checked
- Token cookie is `httpOnly` and `SameSite=Lax`, and `Secure` in production
- Requests that change data must come from this site (CSRF protection in `middleware/originCheck.js`)
- Sign-in and sign-up are rate limited
- Security headers and a strict Content Security Policy through Helmet
- All input is validated on the server; users can only see and change their own data

## Tests

```bash
npm test
```

This runs the unit tests. To also run the full API tests against a throwaway database (it is wiped each run, and its name must contain "test"):

```powershell
$env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017/nexthlon_test"; npm test
```

## Git and GitHub

```bash
git init
git add .
git commit -m "Week 6 base build: JWT auth, profiles, addresses, admin users"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/nexthlon.git
git push -u origin main
```

`.gitignore` already keeps `node_modules` and `.env` out of Git.
