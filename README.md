# Mehdi Shadkhah — personal website

CFD, scientific computing, research, publications, and open-source software.

Live website: https://mshadkhah.github.io

Run locally with `python3 -m http.server 8000`, then open http://127.0.0.1:8000.

Private analytics: https://mshadkhah.github.io/admin.html (owner GitHub sign-in). Dashboard backend and secrets are managed separately in Cloudflare Workers. Local previews do not send website analytics.

The background flow in `flow.js` uses a small velocity grid with pressure projection and Canvas particle trails. Move the cursor to stir, use “Stir the flow” for a pulse, or pause with the motion button. Reduced-motion preferences start the animation paused; hidden tabs stop rendering. No extra dependencies are required.
