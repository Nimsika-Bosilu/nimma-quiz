# Nimma Quiz

Live MCQ competition app with:

- QR join link for players
- Player registration with name and university registration index
- Anonymous player accounts for the current session
- OC dashboard at `/admin`
- Quiz library for separate quizzes
- Add, edit, duplicate, and remove MCQs
- Create a live session from any saved quiz
- Realtime leaderboard
- Kahoot-style animated answer screen
- Static Next.js export, so the frontend can be hosted on GitHub Pages

## Best Hosting Option

GitHub Pages can host the website, but it cannot store player accounts, live scores, or sessions by itself. Use:

- Frontend: GitHub Pages
- Realtime backend: Firebase Authentication + Firestore

This keeps hosting simple and free-tier friendly.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

- Player page: `http://localhost:3000`
- OC dashboard: `http://localhost:3000/admin`

## OC Workflow

1. Open `/admin`.
2. Enter the OC access code from `NEXT_PUBLIC_ADMIN_CODE`.
3. Create a new quiz or load the starter React MCQs.
4. Edit MCQs, options, correct answer, level, and explanation.
5. Save the quiz.
6. Enter a session code, then create a session QR.
7. Display the QR for players.
8. Start the quiz and move through questions from the dashboard.

## Firebase Setup

1. Create a Firebase project.
2. Add a Web App in Firebase.
3. Enable Authentication and turn on Anonymous sign-in.
4. Create Firestore Database.
5. Copy the Firebase web config into `.env.local`.

Example Firestore rules for a small event prototype:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /quizzes/{quizId} {
      allow read: if true;
      allow write: if true;
    }

    match /sessions/{sessionId} {
      allow read: if true;
      allow write: if true;

      match /players/{playerId} {
        allow read: if true;
        allow create, update: if request.auth != null && request.auth.uid == playerId;
      }
    }
  }
}
```

For a serious competition, restrict session writes to OC member accounts instead of using the public prototype rule above.

## GitHub Pages Deploy

If the repository URL is `https://github.com/YOUR_NAME/nimma-quiz`, set:

```env
NEXT_PUBLIC_BASE_PATH=/nimma-quiz
```

Then build:

```bash
npm run build
```

This repo includes `.github/workflows/deploy.yml`. In GitHub:

1. Go to Settings -> Pages -> Source -> GitHub Actions.
2. Add the Firebase values as repository Secrets.
3. Add `NEXT_PUBLIC_BASE_PATH` as a repository Variable if your site is hosted under a repo path, for example `/nimma-quiz`.
4. Push to `main`.

## Admin Code

The current static prototype uses `NEXT_PUBLIC_ADMIN_CODE` to keep casual users out of `/admin`. Because this is visible in frontend builds, it is not strong security. For a real competition, use Firebase Auth for OC members and Firestore rules that only allow those accounts to control sessions.
