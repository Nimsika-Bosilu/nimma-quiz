# Nimma Quiz

Live MCQ competition app with:

- QR join link for players
- Player registration with name and university registration index
- Anonymous player accounts for the current session
- Gmail login for quiz hosts at `/admin`
- Quiz library for separate quizzes
- Add, edit, duplicate, and remove MCQs
- Create a live session from any saved quiz
- Separate projector leaderboard at `/leaderboard/?session=SESSION_CODE`
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
2. Sign in with Gmail.
3. Create a new quiz or load the starter React MCQs.
4. Edit MCQs, options, correct answer, level, and explanation.
5. Save the quiz.
6. Enter a session code and question countdown, then create a session QR.
7. Display the QR for players while the session is in lobby mode.
8. Open the projector leaderboard link in a separate browser tab if needed.
9. Start the quiz and move through questions from the dashboard.

## Firebase Setup

1. Create a Firebase project.
2. Add a Web App in Firebase.
3. Enable Authentication and turn on Google sign-in for hosts.
4. Enable Anonymous sign-in for student session accounts.
5. Create Firestore Database.
6. Copy the Firebase web config into `.env.local`.
7. Add your deployed domain, for example `nimsika-bosilu.github.io`, to Firebase Authentication -> Settings -> Authorized domains.

Example Firestore rules for a small event prototype:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /quizzes/{quizId} {
      allow read, write: if request.auth != null
        && request.auth.token.firebase.sign_in_provider == "google.com";
    }

    match /sessions/{sessionId} {
      allow read: if true;
      allow write: if request.auth != null
        && request.auth.token.firebase.sign_in_provider == "google.com";

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

This repo includes `.github/workflows/nextjs.yml`. In GitHub:

1. Go to Settings -> Pages -> Source -> GitHub Actions.
2. Add the Firebase values as repository Secrets.
3. Add `NEXT_PUBLIC_BASE_PATH` as a repository Variable if your site is hosted under a repo path, for example `/nimma-quiz`.
4. Push to `main`.
