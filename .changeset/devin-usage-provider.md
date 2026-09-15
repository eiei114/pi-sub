---
"@eiei114/pi-sub-core": minor
"@eiei114/pi-sub-bar": minor
"@eiei114/pi-sub-shared": minor
---

Add a Devin usage provider.

`sub-core` reads the `devin` session token from `~/.pi/agent/auth.json`, lists the
organizations it can see, and reports the first readable organization's daily and
weekly quota as `Day` / `Week` windows. `sub-bar` adds the matching window
visibility settings.
