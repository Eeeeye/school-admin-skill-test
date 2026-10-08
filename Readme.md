# School Admin - Backend Assessment Submission

This submission is based on the provided
[marius-stander/skill-test starter repository](https://github.com/marius-stander/skill-test),
starting from commit `1e12b75`. The requested assessment is **Problem 2: student
management CRUD**. The starter application is credited to its original authors;
the implementation and integration changes are included in this repository.
This is a clean source snapshot: historical environment files, local databases,
editor artifacts and private deployment records are not included.

## Review Problem 2

- [Student controllers](backend/src/modules/students/students-controller.js)
- [Validation and business rules](backend/src/modules/students/students-service.js)
- [Database operations](backend/src/modules/students/students-repository.js)
- [Student routes](backend/src/modules/students/sudents-router.js)
- [HTTP integration checks](backend/test/product.integration.js) and
  [backend tests](backend/test/)

The student API supports listing/filtering, creation, detail lookup, partial
updates, access enable/disable and transactional deletion. Authentication,
authorization, CSRF checks, input validation and error responses are included.
Related certificate history is retained when a student is deleted.

Additional work connects the starter UI, school workflows, an isolated EVM
certificate registry, IPFS metadata, and a reproducible Docker deployment.
The Go/PDF report task is **not implemented**. The original challenges are
listed below so the required backend work and additional work can be reviewed
separately.

## Hosted demonstration

- [Application](https://school-demo.eeeeye.online)
- [Public sample certificate](https://school-demo.eeeeye.online/verify/0xa3af39b03e0e52d6bee840a6ccb25e518fd0921f945770eb2e610a9790e46829)

The public certificate page needs no login. The hosted demonstration uses a
private test chain and offline IPFS storage; it is not a real academic credential.
Hosted administrator credentials are not published. The local test account below
only applies to a local development installation.

For the complete HTTPS interview demo on a Linux server, use the independent
[server deployment guide](deploy/README.md) and `docker-compose.server.yml`.
It preserves the isolated demonstration chain and keeps database, IPFS API and
chain RPC ports private. PDF report export remains outside this product scope.

A comprehensive full-stack web application for managing school operations including students, staff, classes, notices, and leave management. 
This project serves as a skill assessment platform for **Frontend**, **Backend**, and **Blockchain** developers.

## 🏗️ Project Architecture

```
skill-test/
├── frontend/           # React + TypeScript + Material-UI
├── backend/            # Node.js + Express + PostgreSQL
├── blockchain/         # Certificate contract + persistent local chain
├── scripts/            # Reproducible product tests
├── deploy/            # Public HTTPS deployment and backup tooling
├── seed_db/           # Database schema and seed data
└── README.md          # This file
```

## 🚀 Quick Start

### Prerequisites
- Node.js 22 for the container build and tested deployment
- PostgreSQL (v15 or higher; the seed uses `UNIQUE NULLS NOT DISTINCT`)
- npm for the Node services; pnpm (or Corepack) for `blockchain/`

### 1. Backend Setup
```bash
cd backend
npm install
cp .env.example .env  # Configure your environment variables
npm start
```

### 2. Frontend Setup
```bash
cd frontend
npm install
cp .env.example .env  # point VITE_API_URL at the local backend
npm run dev
```

### 3. Access the Application
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5007
- **Demo Credentials**: 
  - Email: `admin@school-admin.com`
  - Password: `3OU4zn3q6Zh9`

### Docker Compose

The integrated local product starts with Docker Compose: PostgreSQL, the API,
the web interface, a persistent local EVM chain, and a local IPFS node. PostgreSQL runs the
schema and seed scripts on the first creation of its named volume, then the
backend waits for dependency health checks, applies versioned migrations to
existing databases without clearing their data, then starts.

```bash
docker compose up --build -d --wait
```

The application is available at `http://localhost:5173`, the API health check
is `http://localhost:5007/health`, and the container PostgreSQL instance is
available from the host on port `5433`. In Compose, browser API requests use
the frontend origin and Caddy proxies `/api/*` to the backend service.
To replace the local development defaults, copy `.env.compose.example` to
`.env` before starting Compose.
Use `docker compose down -v` only when you intentionally want to remove the
database, blockchain and IPFS volumes and reset the demonstration.

### Blockchain certificate registry

The integrated `blockchain/` package contains the Solidity certificate
registry, Hardhat tests and an IPFS metadata upload helper. It stores only the
certificate identity and metadata CID on-chain; certificate documents remain
off-chain.

```bash
cd blockchain
pnpm install
pnpm compile
pnpm test
```

### Implementation scope

- Problem 1 is fixed: the notice form now submits `description`.
- Problem 2's student CRUD handlers are implemented. `POST /students/:id/status`
  enables/disables access without deletion, while `DELETE /students/:id`
  permanently removes the student and its student-owned records in a transaction.
- Problem 3 is integrated end to end: student records link to admin certificate
  management, optional EIP-1193 wallet connection, IPFS metadata, a persistent
  Solidity registry, public verification, and revocation.
- Staff departments, navigation and role-permission replacement are connected.
  Notice ownership and leave approval/ownership are enforced in the API.
- Problem 4 (the Go report service) is intentionally out of scope.
- Problem 5's Compose stack starts all five services with health checks and
  persistent data. PDF/student-report export is the only excluded direction.

### Try the product

1. Sign in at `http://localhost:5173` using the local demo admin above.
2. Under **Academics**, create classes and sections if needed. Under **Human
   Resource**, manage departments and staff. Manage students under **Students**.
3. Open a student profile and select **Student certificates**, then **Issue
   certificate**. Choose the student, achievement title and recipient address.
4. Optionally connect an Ethereum wallet to fill the recipient address. The
   school server signs issuance; the connected browser wallet is not asked to
   pay gas or sign school transactions. Without a wallet, enter a recipient
   address manually (local sample: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`).
5. Open **Verify** on a certificate card. The public page works without signing
   in and checks the chain plus IPFS metadata. **Copy link** produces a shareable
   verification URL. **Revoke** updates the on-chain state; the same link then
   shows that the certificate is revoked.
6. If issuance fails, the saved record exposes **Retry**. It keeps the same
   certificate ID and reconciles already submitted transactions. Deleting a
   student removes their school profile but preserves certificate history.

Certificate titles, descriptions and recipient addresses are public metadata.
Student names, emails and internal IDs are not automatically published.
The local chain and IPFS node are only a development deployment; localhost links
are reachable from this computer only. Real email delivery requires a configured
Resend sender/API key. Mail failures do not roll back saved student/staff records.
For a public interview demonstration, use the separate server profile with
HTTPS, secure cookies, fresh secrets and a private persistent demo chain.
Real credentials require a separately selected network and durable storage
design. Never use the public local-chain test key for a public deployment.

### Repeatable verification

Use a dedicated local review stack. Stop any other development stack occupying
the same local ports first; the review stack uses separate named data volumes.

```bash
export COMPOSE_PROJECT_NAME=school-review
docker compose up --build -d --wait
./scripts/test-product.sh
# Fresh installation / repeated migrations (isolated temporary database)
./scripts/test-database.sh
# Dependency failure / recovery checks (restarts local Docker services)
node scripts/test-product-resilience.cjs
# Full UI flow (requires Playwright and Chrome, or CHROME_PATH)
node scripts/test-product-ui.cjs
# UI regressions: refresh races, session cache, missing records, empty lists and validation
node scripts/test-audit-ui.cjs
# Restore DB, certificate chain and IPFS into disposable volumes (isolated review stack only)
node scripts/test-product-restore.cjs
```

Restart rehearsals verify the local Docker endpoint, Compose project, running
development containers and frontend port before any mutation. They refuse to
target the hosted server or an unrelated Docker context.

The API runner covers student/certificate, notice/leave, and department/staff/
class-teacher workflows. The API scripts create isolated fixtures and clean them up. The database test
uses a temporary database and leaves the application database unchanged. Local on-chain test
transactions remain in chain history. The UI smoke creates and revokes a demo
certificate and deletes its test student. Unit/contract tests are available with
`npm test` in `backend/` and `pnpm test` in `blockchain/`; the frontend supports
`node --test test/*.test.cjs`, `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm build`.

The [verification workflow](.github/workflows/verify.yml) runs these checks on
pushes and pull requests using a disposable local Docker stack on the CI runner.
It includes frontend session-isolation regressions, backend authorization and
academic-relationship checks, browser journeys, dependency recovery and a restore
rehearsal. It does not have deployment credentials or update the hosted server.

Earlier local product verification on 2026-10-07 passed 131 real HTTP checks,
52 backend unit tests, 9 contract tests and 10 chain/helper tests. Browser checks covered 12
module routes, real student add/edit/delete forms, certificate issuance/public
verification/revocation, and simulated EIP-1193 wallet events. Fresh installation,
repeat migrations, IPFS/chain outages and persistent restart checks also passed.
The wallet event checks use a test provider; a live browser extension/public
network is a separate deployment check. PDF export is intentionally excluded.

After the server security changes, Node.js 22 verification passed 64 backend
tests, 9 contract tests and 16 chain/helper tests, and the frontend build.
The deployed HTTPS application passed 45 public API checks, login and 12
management-page checks, public certificate verification and revocation, and
data-persistence checks after service restart. Backups passed checksum/archive
checks. That earlier run did not include a full restore rehearsal; the
[8 October review](docs/review-2026-10-08.md) subsequently added and verified it.

A further live Chrome browser audit on 2026-10-07 exercised login, 13 management
pages, section/class creation, student create/edit/filter/delete forms, notice
creation, certificate issue/anonymous verification/revocation, and mobile views.
It found and fixed Everyone-notice editing with null audience fields, misleading
annual dashboard labels, and overlapping mobile notice dates. The dashboard now
omits soft-deleted notices from its preview. A fresh deployed-browser pass verified
these fixes plus sidebar navigation and logout. Email invitations still require
mail-provider configuration; they are not included in the passing browser checks.

### ** Database Setup **
```bash
# Create PostgreSQL database
createdb school_mgmt

# Run database migrations
psql -d school_mgmt -f seed_db/tables.sql
psql -d school_mgmt -f seed_db/seed-db.sql
```

## 🎯 Skill Test Problems

### **Problem 1: Frontend Developer Challenge**
**Fix "Add New Notice" Page**
```bash
- Location: '/app/notices/add'
- Issue: When clicking the 'Save' button, the 'description' field does not get saved
- Skills Tested: React, Form handling, State management, API integration
- Expected Fix: Ensure description field is properly bound and submitted
- Check that there is no issue when backend running
```

### **Problem 2: Backend Developer Challenge**
**Complete CRUD Operations in Student Management**
```bash
- Location: '/src/modules/students/students-controller.js'
- Issue: Implement missing CRUD operations for student management
- Skills Tested: Node.js, Express, PostgreSQL, API design, Error handling
- Expected Implementation: Full Create, Read, Update, Delete operations
```

### **Problem 3: Blockchain Developer Challenge**
**Implement Certificate Verification System**
```bash
- Objective: Add blockchain-based certificate verification for student achievements

- Requirements:
  - Create smart contract for certificate issuance and verification
  - Integrate Web3 wallet connection in frontend
  - Add certificate management in admin panel
  - Implement IPFS for certificate metadata storage
  - Check that there is no issue when backend running
```


### **Problem 4: Golang Developer Challenge**
**Build PDF Report Generation Microservice via API Integration**
```bash
- Objective: Create a standalone microservice in Go to generate PDF reports for students by consuming the existing Node.js backend API.
- Location: A new 'go-service/' directory at the root of the project.
- Description: This service will connect to the existing Node.js backend '/api/v1/students/:id' endpoint to fetch student data, 
  and then use the returned JSON to generate a downloadable PDF report.
- Skills Tested: Golang, REST API consumption, JSON parsing, file generation, microservice integration.
- Requirements:
  - Create a new endpoint 'GET /api/v1/students/:id/report' in the Go service.
  - The Go service must not connect directly to the database; it must fetch data from the Node.js API.
  - The developer must have the PostgreSQL database and the Node.js backend running to complete this task.
```

### **Problem 5: DevOps Engineer Challenge**
**Containerize the Full Application Stack**
```bash
- Objective: Create a multi-container setup to run the entire application stack (Frontend, Backend, Database) using Docker and Docker Compose.
- Location: `Dockerfile` in the `frontend` and `backend` directories, and a `docker-compose.yml` file at the project root.
- Description: The goal is to make the entire development environment reproducible and easy to launch with a single command. 
  The candidate must ensure all services can communicate with each other inside the Docker network.
- Skills Tested: Docker, Docker Compose, container networking, database seeding in a container, environment variable management.
- Requirements:
  - Write a `Dockerfile` for the `frontend` service.
  - Write a `Dockerfile` for the `backend` service.
  - Create a `docker-compose.yml` at the root to define and link the `frontend`, `backend`, and `postgres` services.
  - The `postgres` service must be automatically seeded with the data from the `seed_db/` directory on its first run.
  - The entire application should be launchable with `docker-compose up`.
```


## 🛠️ Technology Stack

### Frontend
- **Framework**: React 18 + TypeScript
- **UI Library**: Material-UI (MUI) v6
- **State Management**: Redux Toolkit + RTK Query
- **Form Handling**: React Hook Form + Zod validation
- **Build Tool**: Vite
- **Code Quality**: ESLint, Prettier, Husky

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Authentication**: JWT + CSRF protection
- **Password Hashing**: Argon2
- **Email Service**: Resend API
- **Validation**: Zod

### Database
- **Primary DB**: PostgreSQL
- **Schema**: Comprehensive school management schema
- **Features**: Role-based access control, Leave management, Notice system

## 📋 Features

### Core Functionality
- **Dashboard**: User statistics, notices, birthday celebrations, leave requests
- **User Management**: Multi-role system (Admin, Student, Teacher, Custom roles)
- **Academic Management**: Classes, sections, students, class teachers
- **Leave Management**: Policy definition, request submission, approval workflow
- **Notice System**: Create, approve, and distribute notices
- **Staff Management**: Employee profiles, departments, role assignments
- **Access Control**: Granular permissions system

### Security Features
- JWT-based authentication with refresh tokens
- CSRF protection
- Role-based access control (RBAC)
- Password reset and email verification
- Secure cookie handling

## 🔧 Development Guidelines

### Code Standards
- **File Naming**: kebab-case for consistency across OS
- **Import Style**: Absolute imports for cleaner code
- **Code Formatting**: Prettier with consistent configuration
- **Git Hooks**: Husky for pre-commit quality checks

### Project Structure
```
frontend/src/
├── api/           # API configuration and base setup
├── assets/        # Static assets (images, styles)
├── components/    # Shared/reusable components
├── domains/       # Feature-based modules
│   ├── auth/      # Authentication module
│   ├── students/  # Student management
│   ├── notices/   # Notice system
│   └── ...
├── hooks/         # Custom React hooks
├── routes/        # Application routing
├── store/         # Redux store configuration
├── theme/         # MUI theme customization
└── utils/         # Utility functions
```

```
backend/src/
├── config/        # Database and app configuration
├── middlewares/   # Express middlewares
├── modules/       # Feature-based API modules
│   ├── auth/      # Authentication endpoints
│   ├── students/  # Student CRUD operations
│   ├── notices/   # Notice management
│   └── ...
├── routes/        # API route definitions
├── shared/        # Shared utilities and repositories
├── templates/     # Email templates
└── utils/         # Helper functions
```

## 🧪 Testing Instructions

### For Frontend Developers
1. Navigate to the notices section
2. Try to create a new notice with description
3. Verify the description is saved correctly
4. Test form validation and error handling

### For Backend Developers
1. Test all student CRUD endpoints using Postman/curl
2. Verify proper error handling and validation
3. Check database constraints and relationships
4. Test authentication and authorization

### For Blockchain Developers
1. Set up local blockchain environment (Hardhat/Ganache)
2. Deploy certificate smart contract
3. Integrate Web3 wallet connection
4. Test certificate issuance and verification flow

### For Golang Developers
1. Set up the PostgreSQL database using `seed_db/` files.
2. Set up and run the Node.js backend by following its setup instructions.
3. Run the Go service.
4. Use a tool like `curl` or Postman to make a GET request to the Go service's `/api/v1/students/:id/report` endpoint.
5. Verify that the Go service correctly calls the Node.js backend and that a PDF file is successfully generated.
6. Check the contents of the PDF for correctness.

### For DevOps Engineers
1. Ensure Docker and Docker Compose are installed on your machine.
2. From the project root, run the command `docker compose up --build`.
3. Wait for all services to build and start.
4. Access the frontend at `http://localhost:5173` and verify the application is running.
5. Log in with the demo credentials to confirm that the frontend, backend, and database are all communicating correctly.

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/logout` - User logout
- `GET /api/v1/auth/refresh` - Refresh access token

### Student Management
- `GET /api/v1/students` - List all students
- `POST /api/v1/students` - Create new student
- `PUT /api/v1/students/:id` - Update student
- `DELETE /api/v1/students/:id` - Delete student

### Notice Management
- `GET /api/v1/notices` - List notices
- `POST /api/v1/notices` - Create notice
- `PUT /api/v1/notices/:id` - Update notice
- `DELETE /api/v1/notices/:id` - Delete notice

### PDF Generation Service (Go, not implemented)
- `GET /api/v1/students/:id/report` is an original assessment requirement, not an available endpoint in this submission.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

The provided starter is linked above for attribution. No separate `LICENSE`
file was included in that starter snapshot; this submission does not add a
new license or replace upstream notices.

## 🆘 Support

For questions and support:
- Create an issue in the repository
- Check existing documentation in `/frontend/README.md` and `/backend/README.md`
- Review the database schema in `/seed_db/tables.sql`

---

**Happy Coding! 🚀**
