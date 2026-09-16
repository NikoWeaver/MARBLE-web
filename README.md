# MARBLE supplementary website

Supplementary material for the anonymous submission "Omnidirectional Amphibious Locomotion via Internal Mass Actuation" (robot: MARBLE). Static HTML/CSS/JS, no build step.

## Preview locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000

## Filling in videos

Each media slot in `index.html` looks like:

```html
<figure class="slot" data-video="media/videos/NAME.mp4" data-poster="media/posters/NAME.jpg">
```

Drop a file at the given path and it will play; if it's missing, `main.js` falls back to the poster (or a gray box) with a "Video placeholder: <path>" tag. `data-video` can also be a full `https://` URL if a clip is hosted externally.

| Path | Content | Paper figure |
|---|---|---|
| `media/videos/fig1a-land-to-water.mp4` | Land-to-water entry | Fig. 1(a) |
| `media/videos/fig1b-terrestrial.mp4` | Terrestrial rolling | Fig. 1(b) |
| `media/videos/fig1c-water.mp4` | Water-surface propulsion | Fig. 1(c) |
| `media/videos/hardware-sliders.mp4` | (optional) Internal mass sliders actuating | Fig. 2 |
| `media/videos/fig3-ground-geometric.mp4` | MuJoCo rollout, ground, geometric controller, 0.5 m/s | Fig. 3 |
| `media/videos/fig3-ground-learned.mp4` | MuJoCo rollout, ground, learned controller, 0.5 m/s | Fig. 3 |
| `media/videos/fig3-water-geometric.mp4` | MuJoCo rollout, water, geometric controller, 0.5 m/s | Fig. 3 |
| `media/videos/fig3-water-learned.mp4` | MuJoCo rollout, water, learned controller, 0.5 m/s | Fig. 3 |
| `media/videos/fig4a-terrestrial.mp4` | Full run behind the terrestrial time-lapse | Fig. 4(a) |
| `media/videos/fig1c-water.mp4` | Aquatic run (same clip as Fig. 1(c)) | Fig. 4(b) |
| `media/videos/fig4c-transition.mp4` | Full run behind the transition time-lapse | Fig. 4(c) |
| `media/videos/fig5a-learned.mp4` | Joystick omnidirectional run, learned controller | Fig. 5 |
| `media/videos/fig5b-geometric.mp4` | Joystick omnidirectional run, geometric controller | Fig. 5 |
| `media/videos/fig6-buoy-push.mp4` | Obstacle interaction with the buoy (approach/contact/push) | Fig. 6 |
| `media/videos/trial-01.mp4` … `trial-04.mp4` | Additional trials carousel | — |

Step chips (`<button class="step-chip" data-seek="SECONDS">`) mark timestamps inside a slot's figure, e.g. approach/contact/push for Fig. 6. TODO chips ship with `data-seek=""` — fill in the seek time in seconds once the corresponding clip is in place.

Posters (`data-poster`) are optional; without one, missing videos fall back to a plain placeholder box.

## Encoding clips

```
ffmpeg -i input.mov -map_metadata -1 -an -c:v libx264 -crf 23 -preset slow -pix_fmt yuv420p -vf "scale='min(1920,iw)':-2" -movflags +faststart media/videos/NAME.mp4
```

Phone-recorded videos commonly embed GPS location and device metadata; `-map_metadata -1` strips it. Keep clips small. If the anonymizer rejects a large file, host it on an anonymous bucket instead and put the `https://` URL directly in `data-video`.

## Before submitting

- Run `python3 tools/preflight.py` and resolve everything it flags.
- Remove or fill every `<div class="todo">` block in `index.html`.
- Add your names, lab, and GitHub username to the 4open.science anonymization term list.
- Keep the `noindex` meta tag in place until camera-ready.

## Hosting on anonymous.4open.science

1. Sign in with GitHub.
2. Anonymize this repository.
3. Enable the website/page option, serving the site from the repo root.
4. Share the resulting `/w/<id>/` link.

All asset paths in this site are relative, so it works correctly when served from a sub-path. (The exact steps and UI may change — follow whatever the anonymizer's current interface shows.)
