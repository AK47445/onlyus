# OnlyUs

Our daily photo log: one photo at a time, whatever we're up to.

Live at **https://ak47445.github.io/onlyus/** once GitHub Pages is on (Settings → Pages → Branch: `main`, folder `/ (root)`).

## How it works

- Plain HTML/JS hosted on GitHub Pages. There's no build step.
- **Firebase Authentication** (Google sign-in) and **Cloud Firestore** store the photos and captions. It runs on the free Spark plan, with no billing card needed.
- Photos are resized to about 1600px and saved inside Firestore, so Firebase Storage isn't needed.
- `firestore.rules` lets only two Google accounts read or write anything.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page and its styles |
| `app.js` | Sign-in, feed, add / edit / remove, zip import |
| `firebase-config.js` | Your Firebase web config (paste it in) |
| `firestore.rules` | Security rules to paste into Firebase (put in your two emails) |

## One-time Firebase setup

1. Go to [console.firebase.google.com](https://console.firebase.google.com), click **Create a project**, and name it `onlyus`. You can turn Google Analytics off.
2. Under **Build → Authentication → Get started → Sign-in method**, enable **Google**.
3. Under **Authentication → Settings → Authorized domains**, add `ak47445.github.io`.
4. Under **Build → Firestore Database → Create database**, pick a location near you and start in **production mode**.
5. Under **Firestore → Rules**, paste in `firestore.rules`, replace the two emails with yours and hers, and click **Publish**.
6. Under **Project settings (gear) → Your apps → Web (`</>`)**, register an app called `onlyus` (skip Hosting) and copy the `firebaseConfig` values into `firebase-config.js`.

## Bringing over the photos from the Claude version

1. On the Claude version of OnlyUs, tap **Download all photos (.zip)** at the bottom.
2. On the GitHub version, sign in, then tap **Import photos from Claude (.zip)** and pick that file.

Captions, dates and order all come across. Running the import twice won't make duplicates.
