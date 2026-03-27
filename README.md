# OS&E Cloud Inventory System

Cloud-based Operating Supplies & Equipment (OS&E) inventory management system, designed for hotels and scalable to other industries.

**Phase 1 MVP — April 2026 Workshop Demo**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 |
| State | Zustand |
| HTTP | Axios (with refresh-retry) |
| Backend | Node.js + Express |
| ORM & Schema | Prisma 5 |
| Database | PostgreSQL 16 |
| Auth | JWT (access 15m + refresh 7d) |
| CI/CD | GitHub Actions |
| Local Dev DB | Docker Compose |

---

## Quick Start

### Prerequisites
- Node.js 20+
- Docker Desktop (for local PostgreSQL)
- Git

### 1. Clone & Install

```bash
git clone <repo-url>
cd ose-inventory-system/backend && npm install
cd ../frontend && npm install
```

### 2. Configure Environment

```bash
cd ose-inventory-system/backend
cp .env.example .env
# Edit .env — set JWT_SECRET, JWT_REFRESH_SECRET (generate secure randoms)
```

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Start Database

```bash
cd ose-inventory-system/backend
docker compose up -d postgres
```

### 4. Run DB Migrations & Seed

```bash
cd ose-inventory-system/backend
npm run db:migrate    # creates all tables
npm run db:seed       # loads demo hotel data (Grand Horizon Hotel)
```

### 5. Start Development Servers

Use two terminals (API + UI):

```bash
# Terminal 1 — API (port 4000)
cd ose-inventory-system/backend
npm run dev
```

```bash
# Terminal 2 — UI (port 5173)
cd ose-inventory-system/frontend
npm run dev
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:4000
- **Health check:** http://localhost:4000/health
- **DB Studio:** from `backend/`, run `npm run db:studio`

---

## Demo Credentials

**Hotel ID (Tenant Slug):** `grand-horizon`  
**All user passwords:** `Admin@123`

| Role | Email |
|---|---|
| Admin | admin@grandhorizon.com |
| Storekeeper | store@grandhorizon.com |
| Dept Manager (F&B) | fb.manager@grandhorizon.com |
| Dept Manager (HK) | hk.manager@grandhorizon.com |
| Cost Control | cost@grandhorizon.com |
| Finance Manager | finance@grandhorizon.com |
| Auditor | auditor@grandhorizon.com |

---

## API Reference — M01 Auth & Users

Base URL: `http://localhost:4000/api`

### Auth Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | ❌ | Login with email + password + tenantSlug |
| POST | `/auth/refresh` | ❌ | Refresh access token using refresh token |
| POST | `/auth/logout` | ✅ | Revoke refresh token |
| GET | `/auth/me` | ✅ | Get current user profile |

### Login Request
```json
POST /api/auth/login
{
  "email": "admin@grandhorizon.com",
  "password": "Admin@123",
  "tenantSlug": "grand-horizon"
}
```

### Login Response
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": {
      "id": "uuid",
      "email": "admin@grandhorizon.com",
      "firstName": "Sarah",
      "lastName": "Ahmed",
      "role": "ADMIN",
      "tenantId": "uuid",
      "tenantName": "Grand Horizon Hotel"
    }
  }
}
```

### Users Endpoints (Admin only)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/users` | List users (paginated, filterable) |
| GET | `/users/:id` | Get user by ID |
| POST | `/users` | Create new user |
| PUT | `/users/:id` | Update user profile |
| PUT | `/users/:id/role` | Change user role |

### Audit Log (Admin / Auditor / Finance)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/audit-log` | List audit events (filterable) |
| GET | `/audit-log/:entityType/:entityId` | History for one record |

---

## Project Structure

```
ose-inventory-system/
├── backend/                     ← API, Prisma, Docker DB, docs
│   ├── docker-compose.yml       ← Local PostgreSQL
│   ├── docs/
│   ├── dev/                     ← Optional scripts & sample exports
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seeds/index.js
│   ├── src/
│   ├── .env.example
│   └── package.json
├── frontend/                    ← React + Vite UI
│   ├── src/
│   └── package.json
└── .gitignore
```

---

## Module Build Plan

| Module | Code | Weeks |
|---|---|---|
| Auth + RBAC + Tenant | M01 | ✅ Week 1 |
| Item Master | M02 | Week 2 |
| Categories | M03 | Week 1 |
| Locations | M04 | Week 1 |
| UOM + Conversions | M05 | Week 1 |
| Suppliers | M06 | Week 1 |
| Opening Balance Import | M07 | Weeks 3–4 |
| Inventory Ledger (WAC) | M08 | Weeks 3–4 |
| Standard Movements | M09 | Weeks 4–5 |
| Controlled Movements | M10 | Weeks 5–6 |
| Approval Workflow | M11 | Week 5 |
| Stock Count | M12 | Weeks 6–7 |
| Reports + Excel Export | M13 | Weeks 7–8 |
| Audit Trail | M14 | Weeks 1–8 |
| Demo Data + UI Polish | M15 | Week 8 |
