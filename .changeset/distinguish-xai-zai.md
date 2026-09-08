---
"@eiei114/pi-sub-shared": patch
"@eiei114/pi-sub-core": patch
"@eiei114/pi-sub-bar": patch
---

Stop detecting xAI (Grok) as z.ai. These are unrelated providers; an xAI session must not display the user's z.ai subscription quota. z.ai detection remains unchanged. This fix does not add xAI billing support.
