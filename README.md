# Tech Titan Team

A React + Express + Firebase Firestore app for a student notes community with password signup/sign-in, Mailjet password reset links, Drive-backed notes, blocked-user controls, and an admin-only portal.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `server/.env.example` to `server/.env` and fill in the Firebase service account, Mailjet sender, and admin email values.
3. Start both apps with `npm run dev`.
4. Open `http://localhost:5173`.

```env
JWT_SECRET=replace-this-in-production
CLIENT_URL=http://localhost:5173
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
ADMIN_EMAILS=admin@yourcollege.edu
MAILJET_API_KEY=
MAILJET_SECRET_KEY=
MAILJET_SENDER_EMAIL=
```

Enable Firestore in the Firebase console. The API exposes `/api/auth/signup`, `/api/auth/request-otp`, `/api/auth/verify-otp`, `/api/auth/signin`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/notes`, `/api/folders`, `/api/admin/notes`, `/api/admin/users`, `/api/admin/users/:id/block`, `/api/admin/users/:id/role`, and `/api/admin/users/export`.

Notes are private: a signed-in, non-blocked user is required for every notes request. All signed-in users can view approved notes across years. Full admins can grant note-manager access; note managers can upload, edit, and delete notes in the admin panel, but cannot manage users, folders, roles, or exports. Signup requires the email OTP and year; sign-in uses only email and password. Deleting a subject folder also deletes its notes. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` to bootstrap the full admin account on server start. The admin `.xlsx` export contains `Students` and `Uploaded Notes` worksheets.
