# Onboarding demo video

Drop your 8–10s demo clip here as **`demo.mp4`** and it will be picked up
automatically — `src/components/onboarding/DemoVideo.tsx` requires this path and
falls back to an animated placeholder while the file is absent.

Keep it small (< 3 MB): it ships inside the APK, and the app makes no network
requests, so it cannot be streamed.

- Format: H.264 mp4, portrait, ~720x1280
- It loops, so make the last frame lead back into the first.
