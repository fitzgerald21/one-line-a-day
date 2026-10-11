# One Line a Day

A digital copy of the **One Line a Day: A Five-Year Memory Book** — the teal cloth cover, the cream pages with
five ruled sections per date, the gold year badges and a page-turn you can actually drag. Works on a phone or a
computer; no build step, no server, no account.

## Using it

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

## Hosting

It is a static site — GitHub Pages serves it as-is (Settings → Pages → *Deploy from a branch* → `main` / root).
To try it locally: `python3 -m http.server` and open <http://localhost:8000>.

## Layout

```
index.html        app shell            import.html   photo import
js/book.js        3D book + page flipping + in-place editing
js/assist.js      dictate / summarize bar      js/ai.js   Groq, OpenRouter, DeepInfra calls
js/store.js       entries + settings storage   js/views.js Journal / Calendar / Progress
js/settings.js    settings sheet               js/modelpicker.js  live model & price picker
css/styles.css    all styling                  sw.js, manifest.webmanifest  offline / installable
```
