# revpdf — Commands & Run Guide

Practical commands for building and running revpdf on this machine.
Run them from the project root: `C:\Users\Admin\Desktop\revpdf`.

> Toolchain is already installed: **JDK 17** (`C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot`)
> and the **Android SDK on D** (`D:\Android\Sdk`). Env vars `ANDROID_HOME`, `ANDROID_SDK_ROOT`,
> `JAVA_HOME`, `GRADLE_USER_HOME=D:\.gradle` are set at user scope — they apply in **new**
> terminals. If a command can't find `adb`/`java`, open a fresh PowerShell window first.

---

## 1. One-time: enable USB debugging on the phone
1. **Settings → About phone** → tap **Build number** 7 times (enables Developer options).
2. **Settings → System → Developer options** → turn on **USB debugging**.
3. Connect the phone with a USB cable; choose **File transfer (MTP)** if prompted.
4. On the phone, accept **"Allow USB debugging?"** → check **Always allow** → **OK**.

## 2. Confirm the phone is detected
```powershell
adb devices
```
Expected: your device listed with `device` (not `unauthorized` / `offline`).

- If empty: replug the cable, re-check USB debugging, try another cable/port.
- If `unauthorized`: accept the popup on the phone.
- If `adb` is not recognized: use the full path or open a new terminal:
  ```powershell
  D:\Android\Sdk\platform-tools\adb.exe devices
  ```

## 3. Build & install on the phone (first run)
```powershell
npx expo run:android
```
First run downloads Gradle + dependencies (~1.5–2 GB into `D:\.gradle`) and compiles
(~5–15 min). It installs the **dev client** APK on the phone and starts Metro. Leave the
terminal open while developing.

## 4. Day-to-day development (after the dev client is installed)
```powershell
npx expo start --dev-client
```
Then press **a** to open on the connected Android device, or open the **revpdf** app on the
phone and connect to the dev server. Reloads on save; no rebuild needed unless native deps change.

You only need to re-run `npx expo run:android` when native code/deps change (new native module,
`app.json` native config, etc.).

---

## 5. Reader engine asset
The WebView reader (`assets/reader/reader.html`) is generated from vendored libs + controller.
**Re-run this whenever you edit `src/reader-web/controller.js` or `src/reader-web/reader.css`:**
```powershell
npm run build:reader
```

## 6. Quality checks
```powershell
npx tsc --noEmit          # typecheck
npx expo-doctor           # validate SDK/deps/config
npx expo export --platform android --output-dir .\dist-check   # verify it bundles (no device)
```

---

## 7. Wireless (optional, no cable)
After step 3 once over USB, you can go cable-free on the same Wi‑Fi:
```powershell
adb tcpip 5555
adb shell ip route        # note the phone's IP (e.g. 192.168.1.23)
adb connect 192.168.1.23:5555
adb devices               # should show <ip>:5555
```

## 8. Troubleshooting
- **`Failed to resolve the Android SDK path`** → open a new terminal (env vars), or set for the
  session:
  ```powershell
  $env:ANDROID_HOME="D:\Android\Sdk"; $env:ANDROID_SDK_ROOT="D:\Android\Sdk"
  ```
- **Gradle can't find the SDK** → `android\local.properties` should contain `sdk.dir=D:\\Android\\Sdk`.
- **JAVA_HOME / wrong Java** → should be `C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot`.
- **C: drive low on space** → SDK and Gradle caches are on D; the app build output
  (`android\app\build`, ~0.5–1 GB) stays on C with the project. If C gets tight, tell me and I'll
  redirect the build directory to D.
- **Clean Android build:**
  ```powershell
  cd android; .\gradlew clean; cd ..
  ```

---

### Reference paths
| What | Path |
|---|---|
| Android SDK | `D:\Android\Sdk` |
| adb | `D:\Android\Sdk\platform-tools\adb.exe` |
| JDK 17 | `C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot` |
| Gradle cache | `D:\.gradle` |
| Project | `C:\Users\Admin\Desktop\revpdf` |
