# My Theme — a Clawd desktop pet theme

A simple **static** theme for [clawd-on-desk](https://code.claude.com). Eye tracking and
mini mode are off, and it uses the `direct` sleep path, so it needs only 5 still images.
Replace the placeholder SVGs in `assets/` with your own art to make it yours.

## Folder shape

```
my-theme/
  theme.json
  assets/
    idle.svg      ← no agent activity
    thinking.svg  ← prompt submitted
    working.svg   ← agent using tools
    happy.svg     ← task completed (attention)
    sleeping.svg  ← asleep
```

`error` and `notification` reuse `happy.svg` via `fallbackTo`, so you don't need
separate art for them.

## Install

1. Copy the whole `my-theme/` folder into your Clawd user themes directory:
   - **Windows:** `%APPDATA%/clawd-on-desk/themes/my-theme/`
   - **macOS:** `~/Library/Application Support/clawd-on-desk/themes/my-theme/`
   - **Linux:** `~/.config/clawd-on-desk/themes/my-theme/`
2. Open `Settings...` → `Theme` and select **My Theme**.
3. Restart Clawd if it doesn't appear yet.

## Customize

- Edit `theme.json` — change `name`, `author`, `description`.
- Swap the files in `assets/` (any format works since eye tracking is off:
  SVG, GIF, APNG, WebP, PNG, JPG). Keep every asset on the same `45×45` canvas
  so the character doesn't jump between states.
- Want animation? Replace a `.svg` with a looping `.gif` / `.apng` and update the
  filename in `theme.json`.

## Validate (in the clawd-on-desk repo)

```bash
node scripts/validate-theme.js path/to/my-theme
```

## Notes

- Don't name the folder `clawd`, `calico`, or `cloudling` — those collide with built-in themes.
- JavaScript inside SVG files is stripped from external themes for security. Use
  CSS `@keyframes` or GIF/APNG for motion.
