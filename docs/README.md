# Vishrea Studio — Documentation Master Index

**Project:** VISHREA STUDIO (`vishreastudio.com`)  
**Architecture:** Modular Monolith with React SPA Storefront  
**Last Updated:** November 22, 2026  

---

## Central Documentation Directory (`docs/`)

The repository documentation is organized into clear functional domains to support development, auditing, security, and long-term operations.

```text
docs/
├── architecture/     System architecture, scalability assessments, performance audits
├── database/         Database schema, optimizations, inventory logic, migrations
├── security/         Security reviews, authentication audits, privacy readiness
├── setup/            Developer onboarding, Supabase configuration, local setup
├── deployment/       Production runbooks, go-live checklists, hosting architecture
├── testing/          Test reports, UI visual QA, accessibility & responsive matrices
├── audits/           Independent implementation audits, client feedback reports
├── seo/              Premium SEO, AEO (Answer Engine) and GEO reports
├── maintenance/      Repository maintenance guide, cleanup logs, changelogs
├── client/           Client specifications, requirements traceability, gap analyses
├── technical/        Developer handover documentation, API specs, database schemas
└── archive/          Historical notes and superseded development logs
```

---

## 1. `architecture/` — System Architecture & Scalability
- [SUPABASE_AUTH_ARCHITECTURE.md](architecture/SUPABASE_AUTH_ARCHITECTURE.md): Complete Supabase Auth + Session exchange architecture.
- [MASTER_ARCHITECTURE_AUDIT.md](architecture/MASTER_ARCHITECTURE_AUDIT.md): Comprehensive system architectural evaluation.
- [API_OPTIMIZATION.md](architecture/API_OPTIMIZATION.md): Backend throughput and API latency optimization.
- [SCALABILITY_ASSESSMENT.md](architecture/SCALABILITY_ASSESSMENT.md): Concurrency, database pooling, and load scaling analysis.
- [PERFORMANCE_AUDIT.md](architecture/PERFORMANCE_AUDIT.md): Server timing, payload sizing, and database query budgets.

---

## 2. `database/` — Schema & Data Modeling
- [DATABASE_OPTIMIZATION.md](database/DATABASE_OPTIMIZATION.md): Indexing strategy, query execution plans, and pool tuning.
- [EXISTING_ACCOUNT_MIGRATION_PLAN.md](database/EXISTING_ACCOUNT_MIGRATION_PLAN.md): Customer account linking without data loss.
- [ADMIN_ID_GENERATION_REPORT.md](database/ADMIN_ID_GENERATION_REPORT.md): UUID vs textual admin ID compatibility analysis.
- [PROFILE_FIELD_VALIDATION_MATRIX.md](database/PROFILE_FIELD_VALIDATION_MATRIX.md): User profile field constraints and validation rules.
- [SOLD_OUT_INVENTORY_LOGIC.md](database/SOLD_OUT_INVENTORY_LOGIC.md): Race-safe inventory reservation and stock depletion logic.
- [COURIER_MANAGEMENT.md](database/COURIER_MANAGEMENT.md): Courier tracking, AWB formats, and dispatch workflows.
- [supabase_complete_schema.sql](database/supabase_complete_schema.sql): Single-file consolidated database reference schema.

---

## 3. `security/` — Security & Threat Modeling
- [AUTHENTICATION_SECURITY_AUDIT.md](security/AUTHENTICATION_SECURITY_AUDIT.md): In-depth security analysis of OTP, JWT, rate limiting, and RBAC.
- [SECURITY_REVIEW.md](security/SECURITY_REVIEW.md): Endpoint authorization, parameter sanitization, and session revocation.
- [FINAL_STORAGE_PRODUCTION_READINESS.md](security/FINAL_STORAGE_PRODUCTION_READINESS.md): Supabase Storage bucket policies and access controls.

---

## 4. `setup/` — Developer Setup & Integration
- [SUPABASE_AUTH_SETUP_GUIDE.md](setup/SUPABASE_AUTH_SETUP_GUIDE.md): Step-by-step Supabase Auth integration and credential setup.
- [LOCAL_DEV_QUICKSTART.md](setup/LOCAL_DEV_QUICKSTART.md): Quickstart instructions for running local PostgreSQL and Vite.

---

## 5. `deployment/` — Production Deployment & Operations
- [PRODUCTION_DEPLOYMENT_GUIDE.md](deployment/PRODUCTION_DEPLOYMENT_GUIDE.md): Executable production deployment guide, architecture, Render specs, and runbook.
- [FINAL_DEPLOYMENT_VERIFICATION_REPORT.md](deployment/FINAL_DEPLOYMENT_VERIFICATION_REPORT.md): Final deployment verification, honest test reconciliation, and readiness verdict.
- [FINAL_GO_LIVE_CHECKLIST.md](production/FINAL_GO_LIVE_CHECKLIST.md): Pre-flight verification checklist before DNS cutover.
- [FINAL_PRODUCTION_GO_NO_GO_REPORT.md](production/FINAL_PRODUCTION_GO_NO_GO_REPORT.md): Comprehensive production readiness assessment.
- [ANALYTICS_AND_OPERATIONS_READINESS.md](production/ANALYTICS_AND_OPERATIONS_READINESS.md): Monitoring, operational alerting, and logs.

---

## 6. `testing/` — QA, Accessibility & Verification
- [UNIT_COMPONENT_INTEGRATION_TEST_REPORT.md](testing/UNIT_COMPONENT_INTEGRATION_TEST_REPORT.md): Full-stack component and unit test report.
- [API_FUNCTIONAL_TEST_REPORT.md](testing/API_FUNCTIONAL_TEST_REPORT.md): Verification of all 29 REST endpoints.
- [END_TO_END_USER_JOURNEY_REPORT.md](testing/END_TO_END_USER_JOURNEY_REPORT.md): Validation of customer and admin user journeys.
- [BUTTON_LINK_AND_INTERACTION_AUDIT.md](testing/BUTTON_LINK_AND_INTERACTION_AUDIT.md): Interactive element inventory and functional testing.
- [COMPLETE_UI_VISUAL_QA_REPORT.md](testing/COMPLETE_UI_VISUAL_QA_REPORT.md): Route-by-route visual inspection and UI consistency.
- [RESPONSIVE_LAYOUT_VALIDATION.md](testing/RESPONSIVE_LAYOUT_VALIDATION.md): Multi-viewport testing (320px to 1920px).
- [ACCESSIBILITY_AND_USABILITY_REPORT.md](testing/ACCESSIBILITY_AND_USABILITY_REPORT.md): WCAG 2.1 AA audit, contrast, and keyboard navigation.
- [REGRESSION_AND_COMPATIBILITY_REPORT.md](testing/REGRESSION_AND_COMPATIBILITY_REPORT.md): Platform regression verification.
- [LOAD_TEST_REPORT.md](testing/LOAD_TEST_REPORT.md): Performance under high concurrent traffic.

---

## 7. `audits/` — Formal Audit Deliverables
- [SUPABASE_AUTH_FINAL_INDEPENDENT_VERIFICATION.md](audits/SUPABASE_AUTH_FINAL_INDEPENDENT_VERIFICATION.md): Independent security and authentication verification.
- [SUPABASE_AUTH_IMPLEMENTATION_REPORT.md](audits/SUPABASE_AUTH_IMPLEMENTATION_REPORT.md): Email OTP delivery and database mapping report.
- [CLIENT_FEEDBACK_IMPLEMENTATION_REPORT.md](audits/CLIENT_FEEDBACK_IMPLEMENTATION_REPORT.md): Client change requests traceability.
- [FULL_STACK_FUNCTIONAL_AUDIT.md](audits/FULL_STACK_FUNCTIONAL_AUDIT.md): Comprehensive end-to-end functionality audit.

---

## 8. `seo/` — Pro SEO, AEO & GEO Grounding
- [PREMIUM_PRO_SEO_AEO_GEO_REPORT.md](seo/PREMIUM_PRO_SEO_AEO_GEO_REPORT.md): Pro SEO, Answer Engine Optimization (`llms.txt`), and Geographic Schema (`GeoCoordinates`).
- [HOMEPAGE_SEO_AND_LAYOUT_REPORT.md](seo/HOMEPAGE_SEO_AND_LAYOUT_REPORT.md): Homepage semantic markup, JSON-LD graphs, and metadata.

---

## 9. `maintenance/` — Repository Standards & Lifecycle
- [REPOSITORY_STRUCTURE_AUDIT.md](maintenance/REPOSITORY_STRUCTURE_AUDIT.md): Full file inventory and structural classification.
- [FILE_CLEANUP_REPORT.md](maintenance/FILE_CLEANUP_REPORT.md): Inventory of moved files, removed artifacts, and dependency sanitization.
- [REPOSITORY_MAINTENANCE_GUIDE.md](maintenance/REPOSITORY_MAINTENANCE_GUIDE.md): Contribution guidelines, code placement, and testing rules.
- [POST_CLEANUP_REGRESSION_REPORT.md](maintenance/POST_CLEANUP_REGRESSION_REPORT.md): Verification evidence following repository cleanup.
- [IMPLEMENTATION_CHANGELOG.md](maintenance/IMPLEMENTATION_CHANGELOG.md): Historical changelog.
- [PROJECT_STATUS.md](maintenance/PROJECT_STATUS.md): Current release status.
