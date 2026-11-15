# PictureThis: Mentra miniapp (Mentra Live)

This was scaffolded with `bunx create-mentra-miniapp@beta livingpages --type=camera`. Use the `@beta` tag: the untagged package is a stale dev build.

```bash
cp .env.example .env   # MENTRA_PUBLIC_LP_SERVER=http://<your LAN IP>:8787
bun install
bun dev                # prints a QR code
```

On the phone: Mentra App → Settings → Miniapp Developer Settings → Scan Miniapp QR Code. The phone and the computer must be on the same Wi-Fi; on Android you can use `bun dev --usb` instead.

## Layers

- **`src/background/`** runs in a bare JS engine, so there's no DOM.
  - `core.ts` is the capture loop. Every interval (2 s by default) it calls `session.camera.takePhoto({size: 'medium', compress: 'medium', sound: false})`. It sends only the `photoUrl` to `POST /v1/frames`.
  - **Button:** short press = look now; long press = pause or resume.
  - **Cue:** a synthesised chime (`chime.ts`, a `data:` WAV), at most once per page, plus optional TTS.
  - **Discoveries** are persisted in `session.storage`. They're queued while the UI is closed and replayed on `onOpen`.
- **`src/ui/`** is React in the WebView:
  - `App.tsx` covers home, the discovery card, explore and settings.
  - `explore.ts` drives the sandboxed runtime from `@lp/runtime/host` and the generation progress.
  - `devicecheck.ts` is the on-device Phase-1 spike: Settings → Developer → device check.
- **`src/shared/channels.ts`** holds the typed channels. `get-state` is the only RPC, and the UI always passes `timeout`.

## Manifest

- **Permission:** `CAMERA`.
- **Hardware:** `CAMERA` REQUIRED; `SPEAKER` and `BUTTON` OPTIONAL.

## SDK notes (checked against `@mentra/miniapp@3.4.0-beta.1237` types)

- `takePhoto` rejects with plain `{code, message}` objects: `PERMISSION_NOT_DECLARED`, `REQUEST_ABORTED`, `INTERNAL`, plus `ACTION_TIMEOUT` and `NOT_CONNECTED`.
- `session.capabilities.hasCamera` is documented but not typed. We treat it as a truthy flag.
- `useCapabilities()` is always `null` in the UI, so glasses status comes from the background.
