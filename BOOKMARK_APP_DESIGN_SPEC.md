# Vibe Reader — Bookmark App Design Spec

> A read-later app that helps you rediscover your saved content by *vibe*, not by date.

## The Problem

Existing read-later apps (Pocket [RIP], Instapaper, Readwise Reader) present bookmarks chronologically or by folder. But readers don't choose what to read next based on when they saved it — they choose based on **mood**: "I want something contemplative," "I want something technical and crunchy," "show me something short and surprising."

Three core problems to solve:

1. **Discovery by vibe** — surface the right article for the moment, not the most recent one
2. **Progressive depth** — don't force full articles; let users engage at the summary level they want
3. **Reliable content capture** — scrape and archive articles before they disappear behind paywalls or rot away

---

## Market Context

### The Opportunity Window

- **Pocket shut down** (July 2025, Mozilla killed it)
- **Omnivore shut down** as a service (ElevenLabs acquisition, Nov 2024)
- Users are actively migrating; the market is wide open
- **No existing app** does vibe/mood-based discovery for text content (mymind does it for images only)
- **No bookmark app** uses embedding-based similarity search (Karakeep has an open feature request for it — GitHub issue #441)

### Competitive Landscape

| App | Status | AI Features | Discovery | Price |
|-----|--------|-------------|-----------|-------|
| Readwise Reader | Active, best-in-class | Ghostreader AI chat, summaries, spaced repetition | Chronological + folders | ~$8.99/mo |
| Matter | Active | AI summaries, "see more like this" (post-read) | % match after reading | Free + $8/mo |
| Instapaper | Active, rising (Pocket refugees) | None | Chronological | Free + $2.99/mo |
| Karakeep (fka Hoarder) | Open source, rising | AI auto-tagging (Ollama/OpenAI) | Full-text search | Free (self-host) |
| Wallabag | Open source, mature | None | Folders/tags | Free (self-host) |
| mymind | Active | "Same Vibe" for images | Visual similarity | $5.99-$12.99/mo |

**Our differentiation**: Vibe-first discovery + progressive summarization + card-based triage. No one does all three.

---

## Core UX Concept: Three Modes

The app has three distinct interaction modes, each addressing a different user intent:

### Mode 1: "Vibe Shuffle" (Discovery)

**The headline feature.** A Tinder-style card stack, but instead of swiping on people, you're swiping through your reading backlog filtered by vibe.

**How it works:**
1. User opens the app and sees a **vibe picker** — either:
   - Pre-computed mood clusters: "Deep Dives," "Quick Hits," "Thought-Provoking," "How-To," "Storytelling," "Contrarian Takes"
   - A free-text prompt: "show me something about design that's under 5 minutes"
   - A "Surprise Me" shuffle mode (random walk through embedding space)
2. Articles appear as **swipeable cards** showing: title, source, hero image, one-line AI summary, estimated read time, and a mood/vibe tag
3. **Swipe right** → "Read Now" (opens progressive reader)
4. **Swipe left** → "Not now" (deprioritizes in future shuffles, doesn't delete)
5. **Swipe up** → "More like this" (reseeds the deck with similar articles via embedding nearest-neighbor)
6. **Swipe down** → "Archive" (done with it)
7. **Tap** → Flip the card to reveal the bullet-point summary (progressive Layer 2)

**Why this works:** Swipe cards excel at binary triage. The limitation (too quick for considered decisions) is solved by the card-flip for a summary preview. You never have to commit to reading the full article from the card view.

### Mode 2: "Reader" (Progressive Depth)

When a user commits to an article, they enter a **progressive reader** inspired by Tiago Forte's Progressive Summarization:

| Layer | What User Sees | How It's Generated |
|-------|---------------|-------------------|
| **L0: Card** | Title + one-liner + read time | Auto on save |
| **L1: Key Points** | 3-7 bullet points | Auto on save (single LLM call) |
| **L2: Rich Summary** | 2-3 paragraph summary with the most important quotes highlighted | Auto on save (same LLM call) |
| **L3: Full Article** | Clean reader view of original content with AI-highlighted key passages | Readability extraction + extractive highlighting |
| **L4: Deep Dive** | Chat with the article — ask questions, get clarifications, challenge claims | On-demand (Claude/GPT interaction) |

**The clever UX**: The reader defaults to **L1 (Key Points)** — not the full article. A simple scroll gesture or "Read More" button progressively reveals L2, then L3. Most users will find that L1 or L2 is enough. This dramatically reduces the "I'll never get through my reading list" anxiety.

**Reading features at L3:**
- Estimated read time
- Text-to-speech (Web Speech API baseline, optional cloud TTS upgrade)
- Highlight & annotate
- Share specific quotes
- Font/theme customization (table stakes)

### Mode 3: "Library" (Organization)

A traditional list/grid view for when users want to browse, search, or organize:
- **Search**: Full-text search + semantic search ("articles about climate policy")
- **Auto-tags**: AI-generated topic tags (like Karakeep)
- **Collections**: User-created groupings
- **Filters**: Read/unread, read time, source, date saved, vibe cluster
- **Bulk actions**: Archive, delete, re-tag, export

---

## Architecture

### The "Clever" Insight: One LLM Call Does Almost Everything

On article save, a single structured LLM call produces:
```json
{
  "one_liner": "A 15-word summary",
  "key_points": ["Point 1", "Point 2", "Point 3"],
  "rich_summary": "2-3 paragraph summary...",
  "key_quotes": ["Most important quote 1", "Quote 2"],
  "mood_tags": ["contemplative", "technical", "long-form"],
  "topic_tags": ["machine-learning", "ethics", "governance"],
  "estimated_difficulty": "intermediate",
  "content_type": "essay"
}
```

Cost: ~$0.001/article with GPT-4o mini or Claude Haiku. For 1,000 articles/month, that's **$1**. The embedding call on top is ~$0.01/month. Total AI cost for the entire pipeline: ~$1-2/month per user.

This single call eliminates the need for separate tagging, summarization, mood classification, and difficulty estimation pipelines.

### Tech Stack (Recommended: Minimum Viable Complexity)

```
┌─────────────────────────────────────────────────────┐
│                   Frontend                           │
│  Expo (React Native) — iOS + Android + Web (PWA)    │
│  • react-native-deck-swiper (card swiping)          │
│  • Framer Motion (web animations)                   │
│  • Reader view: custom component                    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                   Backend                            │
│  Supabase (managed PostgreSQL + Auth + Storage)      │
│  • pgvector extension (embedding similarity search)  │
│  • Edge Functions (article processing pipeline)      │
│  • Row Level Security (multi-tenant by default)      │
│  • Realtime subscriptions (sync across devices)      │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌─────────┐ ┌──────────┐
   │ Readability │ │ LLM API │ │ Embedding│
   │ (extract)   │ │ (Claude │ │ API      │
   │ + Playwright│ │  Haiku/ │ │ (OpenAI/ │
   │   fallback  │ │  GPT-4o │ │  Nomic)  │
   └────────────┘ │  mini)  │ └──────────┘
                  └─────────┘
```

**Why Supabase?** It collapses auth, relational DB, vector search (pgvector), file storage, edge functions, and realtime sync into one managed service with a generous free tier. For a solo developer, this is the minimum-complexity choice. No separate vector DB needed — at personal scale (<10K articles), pgvector handles similarity search trivially.

### Content Extraction Pipeline

```
URL saved
  │
  ├─ [Browser Extension path] ──→ Extension captures DOM
  │   (handles paywalled content     from authenticated
  │    the user has access to)        browser session
  │                                        │
  ├─ [URL-only path] ──────────────────────┤
  │   Server fetches URL                   │
  │   ├─ Try: @mozilla/readability (fast)  │
  │   ├─ Fallback: Playwright render       │
  │   └─ Fallback: Jina Reader API         │
  │                                        │
  ▼                                        ▼
  Clean HTML + plain text + metadata
  │
  ├─→ Store original HTML (archive)
  ├─→ Store clean text (reading)
  ├─→ SingleFile snapshot (optional, for full visual archive)
  │
  ├─→ LLM structured call ──→ summaries, tags, mood, difficulty
  ├─→ Embedding API call ──→ 768-dim vector → pgvector
  │
  └─→ Article ready for consumption
```

**Key decisions:**
- **Primary extractor**: `@mozilla/readability` — best F1 score (0.970), JS/TS native, battle-tested (it's Firefox Reader View). No statistical difference from Trafilatura (Python), but keeps us in a single language.
- **Fallback for JS-heavy sites**: Playwright headless browser. Expensive to run, so only triggered when Readability returns suspiciously little content.
- **Fallback for hostile sites**: Jina Reader API (`r.jina.ai/{url}`) — free tier, returns clean markdown. Good escape hatch.
- **Browser extension**: Captures the DOM client-side (like Omnivore did). This is the **only reliable way** to get content behind paywalls the user is logged into. The extension sends the full DOM to the backend for processing.
- **Archival**: Store the extracted clean HTML. Optionally run SingleFile for a pixel-perfect snapshot. Articles disappear from the internet — archiving is non-negotiable.

### Embedding & Vibe Discovery

**Embedding model**: OpenAI `text-embedding-3-small` (768 dims, $0.02/M tokens) or Nomic Embed v1.5 (open source, runs locally). At 1,000 articles, the entire collection fits in memory — brute-force cosine similarity takes microseconds. pgvector becomes useful at 10K+ items.

**Vibe clustering** (how "mood" categories emerge):

1. **On save**: Each article gets a 768-dim embedding + LLM-generated mood tags
2. **Periodically**: Run lightweight clustering (HDBSCAN or K-means) over all embeddings to discover natural topic/mood groups
3. **Cluster labeling**: Ask the LLM to name each cluster based on its member articles ("Deep Technical Dives," "Personal Essays," "Quick News")
4. **Vibe picker**: Present top clusters as swipeable mood chips. User taps one → deck is seeded with articles from that cluster, ranked by embedding distance from cluster centroid
5. **"Surprise Me"**: Random walk — pick a random article, find its 5 nearest neighbors, present as a deck
6. **Free-text vibe search**: Embed the user's query ("something about philosophy that's not too heavy"), find nearest articles by cosine similarity

**Why this is better than manual tags**: Tags require user discipline. Embeddings discover relationships the user never would have tagged — an article about "sourdough bread" and one about "fermentation in winemaking" naturally cluster together without anyone tagging them both "fermentation."

### Progressive Summarization Pipeline

All generated in a **single structured LLM call** on save:

```
System: You are a reading assistant. Given an article, produce a structured
analysis in JSON format.

User: [article text, truncated to ~4000 tokens if needed]

Response schema:
{
  "one_liner": "max 20 words",
  "key_points": ["3-7 bullet points, each 1-2 sentences"],
  "rich_summary": "2-3 paragraphs capturing the core argument and key evidence",
  "key_quotes": ["3-5 most important direct quotes from the article"],
  "mood_tags": ["2-3 tags from: contemplative, technical, urgent, playful, contrarian, narrative, instructional, provocative, analytical, personal"],
  "topic_tags": ["2-4 specific topic tags"],
  "estimated_difficulty": "beginner | intermediate | advanced",
  "content_type": "news | essay | tutorial | opinion | research | interview | listicle"
}
```

**Model choice**: Claude Haiku or GPT-4o mini for bulk processing (~$0.001/article). Offer Claude Sonnet/GPT-4o for the on-demand "Deep Dive" chat (L4) — this is where quality matters and users are explicitly engaging.

**Local/self-hosted option**: Ollama running Mistral 7B or LLaMA 3 8B. Karakeep already validates this pattern. Quality is good enough for tagging/summarization. Free.

---

## Data Model

```sql
-- Core tables (Supabase/PostgreSQL)

create table articles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users not null,
  url           text not null,
  title         text,
  author        text,
  site_name     text,
  hero_image    text,

  -- Extracted content
  clean_html    text,          -- Readability output
  plain_text    text,          -- For search + LLM input
  word_count    integer,
  read_time_min integer,       -- word_count / 238

  -- AI-generated (single LLM call)
  one_liner     text,
  key_points    jsonb,         -- ["point1", "point2", ...]
  rich_summary  text,
  key_quotes    jsonb,         -- ["quote1", "quote2", ...]
  mood_tags     text[],        -- ARRAY['contemplative', 'technical']
  topic_tags    text[],
  difficulty    text,          -- beginner/intermediate/advanced
  content_type  text,          -- essay/tutorial/news/etc.

  -- Embedding
  embedding     vector(768),   -- pgvector

  -- State
  status        text default 'unread',  -- unread/reading/read/archived
  saved_at      timestamptz default now(),
  read_at       timestamptz,

  -- User engagement signals
  swipe_action  text,          -- right/left/up/down from vibe shuffle
  times_surfaced integer default 0,

  created_at    timestamptz default now()
);

-- Indexes
create index on articles using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index on articles using gin (mood_tags);
create index on articles using gin (topic_tags);
create index on articles (user_id, status);
create index on articles using gin (to_tsvector('english', plain_text));  -- full text search

-- Vibe clusters (periodically recomputed)
create table vibe_clusters (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  label       text,            -- AI-generated: "Deep Technical Dives"
  centroid    vector(768),
  article_count integer,
  updated_at  timestamptz default now()
);

-- User highlights & annotations
create table highlights (
  id          uuid primary key default gen_random_uuid(),
  article_id  uuid references articles not null,
  user_id     uuid references auth.users not null,
  text        text not null,
  note        text,
  position    jsonb,           -- {start_offset, end_offset} in clean_html
  created_at  timestamptz default now()
);

-- Collections (user-created groupings)
create table collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  name        text not null,
  description text,
  created_at  timestamptz default now()
);

create table article_collections (
  article_id    uuid references articles,
  collection_id uuid references collections,
  primary key (article_id, collection_id)
);
```

---

## Processing Pipeline (Edge Function / Background Worker)

```
Article Save Event
       │
       ▼
  ┌─────────────────┐
  │ 1. Extract       │  @mozilla/readability → clean HTML + text
  │    Content        │  Fallback: Playwright → Jina Reader API
  └────────┬──────────┘
           │
           ▼
  ┌─────────────────┐
  │ 2. Parallel AI   │  ┌─ LLM call → summaries + tags + mood
  │    Processing     │  │  (single structured call, ~$0.001)
  │                   │  └─ Embedding call → 768-dim vector (~$0.00001)
  └────────┬──────────┘
           │
           ▼
  ┌─────────────────┐
  │ 3. Store &       │  Insert article row with all fields
  │    Index          │  pgvector auto-indexes the embedding
  └────────┬──────────┘
           │
           ▼
  ┌─────────────────┐
  │ 4. Optional:     │  SingleFile snapshot (if user has archival enabled)
  │    Archive        │  Store in Supabase Storage
  └───────────────────┘
```

**Latency budget**: Steps 1+2 should complete in <10 seconds. The user sees the article card immediately (with title/URL from the save action), and the AI-generated fields populate asynchronously. A subtle animation or "processing..." indicator shows the card is being enriched.

---

## Screens (Wire-level Descriptions)

### Home / Vibe Shuffle
```
┌──────────────────────────────┐
│  [logo]  Vibe Reader    [≡]  │
│                              │
│  ┌────────────────────────┐  │
│  │ How are you feeling?   │  │
│  │                        │  │
│  │ [Deep Dives] [Quick]   │  │
│  │ [Thoughtful] [How-To]  │  │
│  │ [Surprise Me ✦]        │  │
│  │                        │  │
│  │   or type a vibe...    │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │    [Hero Image]        │  │
│  │                        │  │
│  │  Article Title Here    │  │
│  │  source.com · 4 min    │  │
│  │                        │  │
│  │  "One-line summary     │  │
│  │   of the article"      │  │
│  │                        │  │
│  │  #contemplative #tech  │  │
│  │                        │  │
│  │  ← skip    read now →  │  │
│  │     ↑ more like this   │  │
│  │     ↓ archive          │  │
│  └────────────────────────┘  │
│                              │
│  ─── ─── ─── (card stack)    │
│                              │
│  [Shuffle]  [Reader]  [Lib]  │
└──────────────────────────────┘
```

### Progressive Reader
```
┌──────────────────────────────┐
│  ← Back         [TTS] [...]  │
│                              │
│  Article Title               │
│  by Author · source.com      │
│  4 min read · #contemplative │
│                              │
│  ┌ Key Points ─────────────┐ │
│  │ • First key point here  │ │
│  │ • Second key point      │ │
│  │ • Third key point       │ │
│  │ • Fourth key point      │ │
│  └─────────────────────────┘ │
│                              │
│      [▼ Read Summary]        │
│                              │  ← Tap to expand L2
│  ┌ Summary ────────────────┐ │
│  │ Two paragraph summary   │ │
│  │ of the article with     │ │
│  │ highlighted quotes...   │ │
│  └─────────────────────────┘ │
│                              │
│      [▼ Read Full Article]   │  ← Tap to expand L3
│                              │
│  ┌ Full Article ───────────┐ │
│  │ Clean reader view with  │ │
│  │ AI-highlighted passages │ │
│  │ (tap to highlight more) │ │
│  │ ...                     │ │
│  └─────────────────────────┘ │
│                              │
│  ┌──────────────────────────┐│
│  │ 💬 Ask about this article││ ← L4: Deep Dive chat
│  └──────────────────────────┘│
└──────────────────────────────┘
```

### Library
```
┌──────────────────────────────┐
│  Library          [🔍] [+]   │
│                              │
│  [All] [Unread] [Collections]│
│                              │
│  🔍 Search or describe...    │
│  (full-text + semantic)      │
│                              │
│  ┌──────────┐ ┌──────────┐  │
│  │ [image]  │ │ [image]  │  │
│  │ Title    │ │ Title    │  │
│  │ 3 min    │ │ 8 min    │  │
│  │ #quick   │ │ #deep    │  │
│  └──────────┘ └──────────┘  │
│  ┌──────────┐ ┌──────────┐  │
│  │ [image]  │ │ [image]  │  │
│  │ Title    │ │ Title    │  │
│  │ 5 min    │ │ 12 min   │  │
│  │ #howto   │ │ #essay   │  │
│  └──────────┘ └──────────┘  │
│                              │
│  [Shuffle]  [Reader]  [Lib]  │
└──────────────────────────────┘
```

---

## Browser Extension

**Functionality:**
1. One-click save (like Pocket's was)
2. Captures the DOM from the current page (critical for paywalled content)
3. Sends DOM + URL + metadata to backend API
4. Shows confirmation with one-liner summary when processing completes
5. Optional: highlight text on any page → save highlight + article in one action

**Architecture**: Manifest V3 Chrome extension + Firefox equivalent. Content script extracts DOM via `document.cloneNode(true)`, sends to background worker, which POSTs to the Supabase Edge Function.

**Reference implementation**: Omnivore's extension (open source, AGPL-3.0) and Karakeep's extension are both good starting points.

---

## Build vs. Extend Decision

### Option A: Build from scratch on Supabase + Expo
**Pros**: Total control, clean architecture, no legacy baggage
**Cons**: More initial work, need to build reader view, extension from scratch

### Option B: Fork/extend Karakeep
**Pros**: Already has browser extension, mobile app, AI tagging, article parsing, SingleFile archival, Pocket/Omnivore import
**Cons**: Next.js (not mobile-native), SQLite (would need to migrate to PostgreSQL for pgvector), no embedding infrastructure, would need significant UI overhaul for card-swiping

### Recommendation: **Option A with Karakeep as reference**

Karakeep validates the patterns (AI tagging, browser extension, content extraction) but its UX is traditional list-based. The vibe-shuffle concept is fundamentally different enough that forking would create more tech debt than starting fresh. Use Karakeep's source code as a reference for:
- Browser extension content capture
- SingleFile integration
- Ollama integration for self-hosted AI
- Pocket/Omnivore import logic

---

## Implementation Phases

### Phase 1: Core Save + Read (MVP)
- Supabase project setup (auth, DB, storage, edge functions)
- Article save via URL (Readability extraction)
- Single LLM call → summaries + tags + mood
- Embedding generation + pgvector storage
- Basic progressive reader (L0-L2)
- Simple list view (Library)
- Web app (PWA via Expo Web)

### Phase 2: Vibe Discovery
- Vibe clustering (HDBSCAN over embeddings)
- Cluster labeling (LLM names the clusters)
- Card-swipe UI (Vibe Shuffle screen)
- "More like this" (swipe up → nearest neighbors)
- Free-text vibe search (embed query → cosine similarity)
- "Surprise Me" mode

### Phase 3: Rich Reading + Extension
- Browser extension (Chrome, with DOM capture)
- Full article reader view (L3) with highlighting
- Text-to-speech
- Article chat / Deep Dive (L4)
- Highlight & annotation system

### Phase 4: Mobile + Polish
- Expo native builds (iOS + Android)
- Offline reading (cache articles locally)
- Push notifications ("Today's vibe: 3 articles about design thinking")
- Import from Pocket, Omnivore, Instapaper, Raindrop
- Export to Readwise, Notion, Obsidian

---

## Open Source Libraries & Services Referenced

### Content Extraction
| Tool | Language | Role | License |
|------|----------|------|---------|
| [@mozilla/readability](https://github.com/mozilla/readability) | JS/TS | Primary article extractor | Apache-2.0 |
| [Playwright](https://playwright.dev/) | JS/TS | Headless browser fallback | Apache-2.0 |
| [Jina Reader](https://jina.ai/reader/) | API | Hostile site fallback | Free tier |
| [SingleFile](https://github.com/nickthedick/single-file-core) | JS | Full-page archival | AGPL-3.0 |

### AI & Embeddings
| Tool | Role | Cost |
|------|------|------|
| Claude Haiku / GPT-4o mini | Structured summarization + tagging | ~$0.001/article |
| OpenAI text-embedding-3-small | Article embeddings | ~$0.01/1000 articles |
| [Nomic Embed v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) | Self-hosted embedding alternative | Free |
| [Ollama](https://ollama.ai) + Mistral 7B | Self-hosted summarization | Free |
| Claude Sonnet / GPT-4o | On-demand deep dive chat | ~$0.02/article |

### Infrastructure
| Tool | Role | Cost |
|------|------|------|
| [Supabase](https://supabase.com) | Auth, DB (pgvector), storage, edge functions | Free tier generous |
| [Expo](https://expo.dev) | Cross-platform app (iOS, Android, Web) | Free |
| pgvector | Vector similarity search in PostgreSQL | Free (Supabase built-in) |

### Reference Implementations
| Project | What to Learn From It |
|---------|----------------------|
| [Karakeep](https://github.com/karakeep-app/karakeep) | Browser extension, SingleFile integration, Ollama AI tagging, import logic |
| [Omnivore](https://github.com/omnivore-app/omnivore) | DOM capture in extensions, Readability fork, full-stack architecture |
| [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox) | Multi-format archival strategies |

---

## Key Design Principles

1. **Summaries first, full articles second.** Default to showing the least content needed to make a decision. Most bookmarked articles don't need full reads.

2. **AI is invisible infrastructure, not a feature.** Users don't care that embeddings power vibe discovery — they care that the app "gets" what they want to read. Never show "AI-powered" badges; just make it work.

3. **Every save should feel instant.** Processing happens in the background. The card appears immediately with URL/title; AI enrichment populates within seconds.

4. **Swipe actions are forgiving.** "Skip" doesn't delete — it just deprioritizes. Everything is recoverable from the Library. Low-stakes interaction encourages exploration.

5. **Self-hostable as an option.** Use Supabase for managed hosting, but keep the architecture compatible with self-hosted PostgreSQL + Ollama for users who want full control (Karakeep proves this market exists).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Readability fails on JS-heavy sites | Playwright fallback → Jina Reader fallback. Browser extension path avoids this entirely. |
| LLM costs at scale | Haiku/4o-mini keeps costs at ~$1/1000 articles. Ollama for self-hosters. Batch processing during off-peak. |
| Vibe clusters feel arbitrary | Let users rename/merge clusters. Add manual mood override per article. Clusters improve as library grows. |
| Card fatigue (swipe burnout) | Limit deck size (20 cards per session). "That's enough for now" card at the end. Multiple entry points (Library, Search, not just Shuffle). |
| Content rot (articles disappear) | Archive on save (clean HTML). Optional SingleFile for pixel-perfect snapshots. |
| Embedding model quality | Start with OpenAI (best quality/cost). Nomic Embed as fallback. Re-embed entire library if switching models (cheap at personal scale). |
