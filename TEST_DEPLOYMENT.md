# Micro Pay — GitHub Test Deployment

## What this test environment does

- GitHub stores the source code.
- The `develop` branch is the testing branch.
- GitHub Actions builds and publishes the React frontend to GitHub Pages.
- The Node/Express backend is checked by a separate CI workflow.
- PostgreSQL remains outside GitHub Pages and should use a separate TEST database.

## Recommended test architecture

GitHub repository → GitHub Pages (React frontend) → TEST API (Node/Express) → TEST PostgreSQL

Do not put production database credentials in GitHub source code.

## GitHub setup

1. Create a repository named `micropay-business-system`.
2. Upload this project to the repository.
3. Create and use a `develop` branch for testing.
4. Go to Settings → Pages → Source and select **GitHub Actions**.
5. In Settings → Secrets and variables → Actions → Variables, create:
   - `TEST_API_URL` = the URL of the test API, including `/api`.
6. Push to `develop`.
7. Open Actions and confirm **Micro Pay Test Frontend** succeeds.
8. GitHub Pages will provide the test URL in the deployment environment.

## Local test

Frontend:

    cd client
    npm install
    npm run dev

Backend:

    cd server
    npm install
    # create .env from .env.example
    npm start

## Important

GitHub Pages only serves the static frontend. It does not run the Express API or PostgreSQL database. The complete test system therefore needs a test API and test PostgreSQL database outside GitHub Pages.
