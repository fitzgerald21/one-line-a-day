# One Line a Day

A digital copy of the **One Line a Day: A Five-Year Memory Book** — the teal cloth cover, the cream pages with
five ruled sections per date, the gold year badges and a page-turn you can actually drag. Works on a phone or a
computer; no build step, no server, no account.

## Using it

The book is a real 3D object (three.js): **drag to turn it over and around while it's closed** (once open, swipes only turn pages), pinch or scroll to zoom,
double-tap the table or press *Reset view* to put it back in your hands. Pages are bendable sheets with physics —
drag one and it follows your finger, flick it and it flies; jump across the year and a handful of leaves riffle past.
On tall phone screens it frames one page at a time (page 2, 3, turn, 4, 5…); wider screens show the full spread.
Tap a line on a page and the view zooms into a flat write view to type or dictate; *Back to the book* returns.
If WebGL isn't available (or you switch it off in *Settings → The book*) it falls back to a flat CSS book.

- **Open the book** – tap the cover. It flips through to today and highlights today's line in gold.
- **Turn pages** – swipe/drag the page, tap the outer edge, use the ‹ › buttons, or the arrow keys.
  Drag along the strip at the bottom to scrub through the year (gold bars show where you've written; the
  white tick is today). Tap the date label to jump to any day, or **Today** to come straight back.
- **Write** – tap any year's section and type, right on the page. Today and any previous day work the same way.
  On narrow screens you get one page at a time; on wide screens (or a tablet) you get the two-page spread.
- **Dictate** (🎙) – records with the microphone and transcribes with **Groq Whisper**.
- **Summarize** (✨) – condenses a ramble into a line with an LLM from **OpenRouter** or **DeepInfra**.
  The original is kept; **Original** puts it back. Pick the model in *Settings → AI*: the live model list and
  per-million-token prices are fetched from the provider, with search, sorting and a "free only" filter.
- **Other views** – *Journal* (timeline + search + "on this day"), *Calendar*, and *Progress* (streaks, a
  year-by-year grid of written / skipped days, and a map of the whole book).
- **Years** – by default only the years you have entries for (first year = earliest entry, up to this year)
  get a row on each page; switch to all five rows in *Settings → The book*.
- **Import old books** – `import.html` (Settings → *Import from photos*): take pictures of your paper pages,
  a vision model transcribes them, you review/fix, then save.

## Data & privacy

Entries and API keys are stored **only in your browser** (`localStorage`). Keys are sent straight from your
browser to Groq / OpenRouter / DeepInfra and nowhere else. Because storage is per-browser:

- Use **Settings → Download backup** now and then (the Progress tab nudges you), and **Restore backup** to move
  entries to another device.
- On iPhone, *Share → Add to Home Screen* so Safari keeps the data and the app opens full screen.

## Moving to Firebase

Storage already sits behind an adapter (`js/storage/`), so going to **Firebase Auth + Firestore** is a config
change, not a rewrite: paste your web-app config into `js/storage/config.js` and the app switches from this
browser's `localStorage` to your account — one document per day at `users/{uid}/entries/{YYYY-MM-DD}`,
offline support, live sync between devices, and an offer to upload what's already on this device. API keys and
per-device options never leave the device. Setup steps, the data model, `firestore.rules` and `firebase.json`
are in [`docs/FIREBASE.md`](docs/FIREBASE.md).

## Hosting

It is a static site — GitHub Pages serves it as-is (Settings → Pages → *Deploy from a branch* → `main` / root).
To try it locally: `python3 -m http.server` and open <http://localhost:8000>.

## Layout

```
index.html        app shell            import.html   photo import
js/book3d.js      3D book (three.js): bending pages, orbit, riffle    js/pagetex.js  page/cover canvas textures
js/book.js        flat book + page flipping + in-place editing (the write view and the no-WebGL fallback)
js/assist.js      dictate / summarize bar      js/ai.js   Groq, OpenRouter, DeepInfra calls
js/store.js       data layer (cache + adapter) js/views.js Journal / Calendar / Progress
js/storage/       local + Firebase adapters    docs/FIREBASE.md  cloud setup
js/settings.js    settings sheet               js/modelpicker.js  live model & price picker
css/styles.css    all styling                  sw.js, manifest.webmanifest  offline / installable
```
