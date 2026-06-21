# Publishing revpdf to the Google Play Store

End-to-end guide: from a built AAB to a live listing. Pairs with
[`COMMANDS.md`](./COMMANDS.md) (local dev) and the build profiles in `eas.json`.

App identity: **revpdf** · package **`com.bksh01.revpdf`** · website **revpdf.in**.

---

## 0. One-time prerequisites
- **Expo account** (free) — for EAS cloud builds. `eas login`.
- **Google Play Developer account** — **$25 one-time** fee, at
  https://play.google.com/console . Approval can take a few hours to a couple of days.
- Branding assets ready (see §3).
- **Privacy policy live** at `https://revpdf.in/privacy` (Play *requires* a working URL).

---

## 1. Build the release AAB (Play wants an .aab, not .apk)
```bash
eas login
eas build:configure          # first time only: registers the EAS project
eas build -p android --profile production
```
- Runs in Expo's cloud (~10–20 min). On first build, accept **"Generate a new Android
  Keystore"** — EAS stores and reuses it (don't lose it; `eas credentials` to inspect).
- Output: a downloadable **.aab** + a build URL on expo.dev.
- For a directly-installable test build instead, use `--profile preview` → **.apk** (shareable
  link or file; not accepted by Play, only for sideloading/testers).

**Versioning:** `eas.json` uses `appVersionSource: "remote"` and `autoIncrement` for production,
so EAS bumps `versionCode` each build. Bump the user-facing `version` in `app.json` (e.g.
`1.0.0` → `1.0.1`) for meaningful releases.

---

## 2. Create the app in Play Console
1. Play Console → **Create app** → name **revpdf**, language, **App** (not game), **Free**.
2. Accept declarations.
3. Left nav → **App content** — complete every section (Play blocks release until done):
   - **Privacy policy** → `https://revpdf.in/privacy`
   - **Data safety** → revpdf collects **no data**, no sharing, everything on-device → declare
     accordingly (quick).
   - **App access** → "All functionality available without special access" (no login).
   - **Ads** → No ads.
   - **Content rating** → fill the questionnaire (a reader app → typically *Everyone*).
   - **Target audience** → choose age groups (not child-directed).
   - **Government apps / financial / health** → No.

---

## 3. Store listing assets (Main store listing)
Prepare before submitting:
- **App icon** — 512×512 PNG (32-bit, no alpha for the Play icon).
- **Feature graphic** — 1024×500 PNG/JPG.
- **Phone screenshots** — at least **2** (min 320px, max 3840px; 16:9 or 9:16). Use real
  in-app shots: library shelf, EPUB reading (dark), the selection→search sheet, settings.
- **Short description** (≤80 chars) — e.g. *"A clean, offline PDF & EPUB reader with web-search on
  selection."*
- **Full description** (≤4000 chars) — list **only supported formats**: PDF, EPUB, Markdown, TXT,
  JSON, CSV, HTML. Do **not** claim DOCX/XLSX yet.
> ⚠️ Replace the **default Expo icon/splash** first (`app.json` → `icon`,
> `android.adaptiveIcon`, `expo-splash-screen`) or the store icon will be the Expo default.

---

## 4. Upload & release (use a testing track first)
1. Play Console → **Testing → Internal testing** → **Create new release**.
2. **App signing:** accept **Play App Signing** (recommended). Your EAS upload keystore signs the
   upload; Google re-signs for distribution.
3. **Upload the .aab** from step 1 (or let EAS submit it — see §5).
4. Add release notes → **Save → Review release → Start rollout to Internal testing**.
5. Add testers (email list or a link) → install via the opt-in link to verify on real devices.
6. When happy: **Production → Create new release** → reuse the same .aab → roll out.
   - First production submission goes through **Google review** (hours → a few days).

---

## 5. Optional: let EAS upload for you
Instead of manual upload:
```bash
eas submit -p android --profile production --latest
```
First run asks for a **Google Service Account JSON** key (Play Console → Setup → API access →
create/link a service account with "Release manager"). After that, `eas submit` pushes new builds
straight to a track.

---

## 6. Release checklist
- [ ] `version` bumped in `app.json`
- [ ] Custom icon + splash (not Expo defaults)
- [ ] `revpdf.in`, `/privacy`, `/terms` live and reachable
- [ ] `eas build -p android --profile production` succeeded (got an .aab)
- [ ] Tested the .apk (`--profile preview`) on a **real device**
- [ ] Play Console: Data safety, content rating, target audience, privacy policy all completed
- [ ] Store listing: icon, feature graphic, ≥2 screenshots, short + full description
- [ ] Internal testing pass → Production rollout
- [ ] Keep the EAS Android keystore safe (`eas credentials`)

---

### Notes
- The `android/` folder is git-ignored; EAS **prebuilds** native code in the cloud from
  `app.json`. You don't commit native folders.
- EAS builds from your **git-committed** tree — commit before every build.
- Updating later: bump `version`, `eas build -p android --profile production`, upload/submit,
  roll out. JS-only changes can also ship via **EAS Update** (OTA) without a store review, if you
  add `expo-updates` later.
