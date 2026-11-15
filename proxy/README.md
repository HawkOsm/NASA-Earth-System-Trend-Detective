# AI reader proxy

A small server between the Trend Detective site and Google's Gemini API. The site is a static page and cannot keep an
API key secret, so this server keeps it and does one thing:

`POST /ask` with `{"text": "has it rained more in the Gobi desert in the nineties?"}` returns Gemini's reading of
the question:

```json
{"place": "Gobi Desert", "lat": 42.5, "lng": 103.5, "start": 1990, "end": 1999, "variable": "PRECTOTCORR", "model": "gemini-3.6-flash"}
```

It never returns a number about the climate. The site looks every number up in its precomputed statistics.

- **Who may call it:** only the site's own addresses (`ALLOWED_ORIGINS`, default the GitHub Pages site and localhost).
- **Limits:** a question is cut at 300 characters; 12 questions a minute per address; 1,500 a day in total.
- **Models:** `MODELS`, tried in order (default `gemini-3.5-flash`, then `gemini-flash-lite-latest`), each with a
  6 second limit.
- **Key:** the environment variable `GEMINI_API_KEY`, filled from Secret Manager. It is not in this repository.
- **No dependencies.** `node server.js` runs it; `node --test` runs its tests.

Deploy (Google Cloud Run, from the repository root):

```bash
gcloud run deploy trend-detective-ai --source proxy --region europe-west1 --allow-unauthenticated --set-secrets GEMINI_API_KEY=gemini-api-key:latest --max-instances 2 --min-instances 0 --memory 256Mi
```

The site's address of this server is `AI_READER_URL` in `web/src/detective/aiReader.ts`.
