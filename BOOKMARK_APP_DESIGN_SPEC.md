# Memmi — Design Spec

> A calm read-later app that helps you choose the right saved piece for your current time, energy, and intent — then consume it at the depth you want.

## Product Thesis

People don't choose from their reading backlog by save date — they choose by available attention. Memmi is **summary-first**, **source-faithful**, and built to make backlog reading feel lighter rather than guiltier.

The market window is real: Pocket is dead (July 2025), Omnivore was acquired and shut down (Nov 2024), and users are actively migrating. But the moat isn't "AI for bookmarks" — competitors are already adding AI features. Memmi's moat is **calm, intent-led text rediscovery with trustworthy summary-first reading**.

---

## Brand & Design Direction

Memmi should feel like a **contemporary literary object** — not a productivity dashboard, not a skeuomorphic bookshelf, and definitely not a dating app.

### Design Rules

- Warm paper-like backgrounds, dark ink text, restrained accent color palette
- Generous whitespace and margin-like layout
- **Text-first composition** — imagery is optional support, never the centerpiece
- Subtle motion: lift, slide, fade, settle
- No page-turn gimmicks, no slot-machine shuffle feel
- Full gesture alternatives, keyboard support on web, `prefers-reduced-motion` support
- **Paper stack aesthetic** — cards feel like leaves of paper, not app tiles

### Voice & Tone

- Thoughtful, not cute
- Bookish, not precious
- Intelligent, not "AI-powered"
- Calm, not gamified

---

## Competitive Landscape

| App | Status | AI Features | Discovery | Price |
|-----|--------|-------------|-----------|-------|
| Readwise Reader | Active, best-in-class | Ghostreader AI chat, summaries, spaced repetition | Chronological + folders | ~$8.99/mo |
| Matter | Active | AI summaries, prioritization, Queue decay | % match, resurfacing | Free + $8/mo |
| Instapaper | Active, rising (Pocket refugees) | None | Chronological | Free + $2.99/mo |
| Raindrop Pro | Active | AI assistant, AI suggestions, permanent copies | Collections + search | $3/mo |
| Karakeep (fka Hoarder) | Open source, rising | AI auto-tagging (Ollama/OpenAI) | Full-text search | Free (self-host) |
| mymind | Active | "Same Vibe" for images | Visual similarity | $5.99-$12.99/mo |

**Our differentiation**: Intent-led discovery + progressive summarization with source grounding + paper-stack triage. No one does all three.

---

## Core Experience Model

Memmi has two primary surfaces and one contextual surface.

### 1. Home — "For This Moment"

The main entry point. Home asks: **What do you have room for?**

#### Intent Selectors

Rather than mixing length, depth, format, and tone into a bag of mood labels, the primary chooser is organized around the user's *state*:

| Selector | What it means |
|----------|---------------|
| **5 min** | Quick reads, time-constrained |
| **15 min** | Medium commitment |
| **Deep Focus** | Long, immersive pieces |
| **Learn Something** | Tutorials, how-tos, technical depth |
| **Reflect** | Essays, personal, contemplative |
| **Catch Up** | Oldest unseen, neglected items |
| **Surprise Me** | Random walk through embedding space |

Plus a **free-text bar** for natural language:
- "design, under 5 minutes"
- "something reflective but not too dense"
- "one practical article about TypeScript"

#### The Reading Stack

Home returns a small curated session of **6–10 candidates**, not an infinite deck. The interaction model is a **paper stack** — cards feel like leaves you're leafing through, not a feed to scroll.

**Card contents** (text-first, editorial feel):
- Title
- Source + read time + format descriptor
- One sentence: *why this fits the selected intent*
- Optional hero image (only when it genuinely helps — not on every card)
- No hashtags in the primary UI — instead: `Reflective · Essay · 7 min`

**Card actions:**
- **Keep** → adds to Today's Stack (a short session shelf of 1–3 chosen items)
- **Pass** → deprioritizes in future sessions (doesn't delete, low stakes)
- **Tap** → flip to reveal Quick Take bullets
- **More like this** → visible button, reseeds with nearest neighbors

**Gesture model** (simplified from the original 4-direction swipe):
- Swipe right = Keep
- Swipe left = Pass
- Tap = Preview Quick Take
- "More like this" and "Done" are visible buttons, not hidden gestures

This preserves speed without making the app feel gimmicky. All gestures have button equivalents for accessibility.

**End state:** User leaves with a **Today's Stack** — a short shelf of 1–3 chosen items to read now.

### 2. Reader — Progressive Depth

The reader opens when an item is selected. It is **not** a bottom-nav destination — it's a contextual view, not a browsable mode.

Four visible layers with calm, explicit names:

| Layer | Name | What User Sees | How It's Generated |
|-------|------|---------------|-------------------|
| L1 | **Quick Take** | 3–5 bullets, each grounded in source text | Auto on save (single LLM call) |
| L2 | **Summary** | 2–3 paragraphs with key evidence | Auto on save (same LLM call) |
| L3 | **Original** | Clean reader view of archived article | Readability extraction |
| L4 | **Ask Memmi** | Grounded Q&A over the article | On-demand (chunked retrieval + LLM) |

**Trust architecture:**
- Every Quick Take bullet and key quote is **traceable back to a source passage**
- Generated content is subtly but clearly labeled as generated
- Quotes are **extracted as exact source spans**, not free-generated by the model
- Easy one-tap verify: tap a bullet to see the source passage highlighted in L3

**The key UX insight:** The reader defaults to **Quick Take** — not the full article. Most users will find that L1 or L2 is enough. This dramatically reduces "I'll never get through my reading list" anxiety.

**First-class completion actions:**
- **"Enough for now"** — summary-level completion is a valid outcome, not a failure
- **"Mark finished"** — explicitly done with this piece
- Track completion as: `previewed`, `summary-complete`, or `full-read`

**Reading features (L3):**
- Estimated read time
- Highlight & annotate
- Share specific quotes
- Font/theme customization
- Text-to-speech (Phase 3+)

### 3. Library

Where the backlog becomes manageable — not where it becomes "organized for organization's sake."

**Primary sections:**
- Inbox (unsorted saves)
- Stack (shortlisted for reading)
- Reading (in progress)
- Finished
- Archive
- Collections (user-created)

**Navigation:** Bottom nav is **Home** and **Library**. Search/command access is always available. Reader opens contextually from either surface.

**Search** (hybrid):
- Keyword / full-text search
- Semantic retrieval (embed query → cosine similarity)
- Structured filters: source, time, format, intent mode, saved date, status, read time

**Smart shelves** do more of the organizational work than manual taxonomy. Collections remain user-created, but the system surfaces emergent groupings.

---

## Discovery & Ranking Model

### Facets (inferred on save)

Rather than making unsupervised clusters the primary UX primitive, each article gets a stable set of facets:

- **Topic** (2–4 tags)
- **Tone** (contemplative, technical, playful, urgent, etc.)
- **Format** (essay, tutorial, news, opinion, interview, etc.)
- **Effort/depth** (beginner, intermediate, advanced)
- **Read time** (computed from word count)
- **Timeliness** (breaking/timely vs. evergreen)

### Session Ranking

When a user selects an intent mode, candidates are ranked by:

1. **Hard constraints** (e.g., max read time for "5 min" mode)
2. **Semantic match** to the user's intent/query
3. **Neglectedness boost** — items saved long ago that haven't been surfaced
4. **Skip/snooze penalties** — recently passed items ranked lower
5. **Diversity** across topic and source (sessions shouldn't collapse into near-duplicates)

### Clustering (deferred to Phase 2+)

Use clustering later for:
- "More like this" refinement
- Optional emergent shelves in Library
- Library visualization for larger collections

---

## Capture & Processing

### Save Pathways (all in Phase 1)

| Method | Phase 1 Behavior |
|--------|-----------------|
| **Paste URL** | Full pipeline: extract → enrich → embed |
| **Browser clipper** | Minimal MV3 extension: capture URL + page title + optional DOM, send to backend. Full DOM capture in Phase 2 |
| **Import** | Pocket, Instapaper, Omnivore CSV/JSON import. Creates items with URLs, queues for processing |
| **Mobile share sheet** | Expo share extension receives URL, queues for processing |

### Processing Pipeline

```
URL received
  │
  ├─→ Immediately create user_item + placeholder document
  │   (user sees card with title/URL instantly)
  │
  ├─→ Queue processing job
  │     │
  │     ├─ 1. Canonicalize URL, dedupe against documents table
  │     ├─ 2. Extract article text + metadata
  │     │     Primary: @mozilla/readability (fast, JS-native)
  │     │     Fallback: Jina Reader API (hostile sites)
  │     │     Future: Playwright render (JS-heavy, Phase 2+)
  │     ├─ 3. Score extraction quality (word count, structure checks)
  │     ├─ 4. Store clean article copy in documents table
  │     ├─ 5. LLM structured enrichment call → summaries, facets, quotes
  │     ├─ 6. Chunk + embed for retrieval and grounded chat
  │     └─ 7. Index for search and discovery
  │
  └─→ Update user_item status: processing → ready
      (card animates from placeholder to enriched)
```

**Runtime split:** Supabase Edge Functions handle ingestion/orchestration (receive URL, create records, dispatch). Heavy work (extraction, LLM calls, embedding, archival) runs on a **background worker queue** — Edge Functions have memory and duration limits that make them wrong for Playwright or long LLM calls.

Worker options for Supabase: Inngest, Trigger.dev, or pg_cron + pg_net for simpler cases. Decision deferred to implementation, but the architecture assumes async workers from day one.

**Latency target:** Placeholder card appears instantly. Enriched card (with Quick Take) within 10–15 seconds.

### Archival

- **Default:** Store clean HTML for all users (extracted article text)
- **Opt-in:** Raw DOM snapshot / SingleFile archive for users who enable archival mode
- **Privacy note:** Raw DOM capture from authenticated pages may include personalized/sensitive data — raw snapshots are opt-in and user-private only
- **Content rot mitigation:** Articles disappear from the internet. The clean HTML archive means Memmi always has the content, even if the original URL dies. Surface a "source unavailable" indicator when the original is gone.

### Browser Extension

- **MV3** (Chrome Manifest V3) with `activeTab` permission (cleaner permission story than broad host access)
- Content script + service worker architecture
- **Phase 1:** Capture URL + page title + basic metadata. One-click save.
- **Phase 2:** Full DOM capture for paywalled content the user has access to
- **Separate Chrome/Firefox builds** from the start — MV3 behavior differs across browsers
- **Licensing caution:** Omnivore and Karakeep extensions are AGPL. Reference for patterns, but don't copy code without licensing clarity.

---

## AI Architecture

### Enrichment Call

A single structured LLM call on save produces all metadata:

```json
{
  "one_liner": "max 20 words",
  "key_points": [
    {
      "point": "Summary bullet",
      "source_quote": "Exact text from the article that supports this point",
      "source_offset": { "start": 1234, "end": 1290 }
    }
  ],
  "rich_summary": "2-3 paragraphs",
  "key_quotes": [
    {
      "quote": "Exact quote from the article",
      "source_offset": { "start": 456, "end": 520 }
    }
  ],
  "tone_tags": ["contemplative", "technical"],
  "topic_tags": ["machine-learning", "ethics"],
  "estimated_difficulty": "intermediate",
  "content_type": "essay",
  "timeliness": "evergreen"
}
```

**Key differences from original spec:**
- **Quotes are exact source spans** with character offsets, not free-generated text. The prompt instructs the model to extract verbatim; post-processing verifies against source.
- **Tone and topic are separate facets** (not a mixed "mood_tags" bag)
- **Timeliness** is a new facet for ranking freshness-sensitive content
- Every AI field is **versioned by model + prompt version** for reprocessing

**Model choice:** Claude Haiku or GPT-4o mini for bulk enrichment (~$0.001/article). Provider abstraction from day one — don't couple to a single vendor.

**Cost model at scale:**

| Scale | LLM Cost/mo | Embedding Cost/mo | Total AI/mo |
|-------|-------------|-------------------|-------------|
| 100 articles/mo (casual) | $0.10 | $0.001 | ~$0.10 |
| 1,000 articles/mo (power) | $1.00 | $0.01 | ~$1.00 |
| 10,000 articles/mo (heavy) | $10.00 | $0.10 | ~$10.00 |

At 10K users averaging 200 articles/mo, total AI cost is ~$200/mo. Viable.

### Embeddings

- **Model:** OpenAI `text-embedding-3-small`
- **Dimensions:** 1536 (default) or explicitly shortened to 768 via the `dimensions` parameter — make this an intentional decision, not an accident
- **Index:** Start with exact search filtered by `user_id` (fast enough for personal-scale libraries <10K items). Add HNSW index only when latency requires it. (Supabase recommends HNSW over IVFFlat.)
- **Reindexing:** At personal scale, re-embedding the entire library on model change is cheap (~$0.10 for 10K articles)

### Grounded Chat (Ask Memmi — L4)

- Chunk article into passages, embed each chunk
- On question: embed query → retrieve top-k relevant chunks → LLM generates answer grounded in retrieved passages
- Every claim in the answer cites the source chunk
- Uses a more capable model (Claude Sonnet / GPT-4o) since the user is explicitly engaging

---

## Data Model

Separating shared content from user state enables deduplication, model reprocessing, and clean multi-device sync.

```sql
-- Canonical document content (shared, deduplicated by URL)
create table documents (
  id                uuid primary key default gen_random_uuid(),
  canonical_url     text unique not null,
  content_hash      text,                    -- hash of clean_text for change detection
  title             text,
  author            text,
  site_name         text,
  hero_image_url    text,
  language          text,

  -- Extracted content
  clean_html        text,                    -- Readability output (archive)
  clean_text        text,                    -- Plain text for search + LLM input
  word_count        integer,
  read_time_min     integer,                 -- word_count / 238

  -- Extraction metadata
  extraction_method text,                    -- 'readability' | 'jina' | 'playwright' | 'extension_dom'
  extraction_score  real,                    -- confidence in extraction quality
  extracted_at      timestamptz,

  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- AI-generated enrichment (versioned, reprocessable)
create table document_ai (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid references documents not null,

  -- Summaries
  one_liner         text,
  key_points        jsonb,          -- [{point, source_quote, source_offset}]
  rich_summary      text,
  key_quotes        jsonb,          -- [{quote, source_offset}]

  -- Facets
  tone_tags         text[],
  topic_tags        text[],
  difficulty        text,           -- beginner/intermediate/advanced
  content_type      text,           -- essay/tutorial/news/opinion/etc.
  timeliness        text,           -- breaking/timely/evergreen

  -- Versioning
  model_id          text not null,  -- e.g. 'claude-haiku-4-5-20251001'
  prompt_version    text not null,  -- e.g. 'v2'

  created_at        timestamptz default now(),

  unique(document_id, model_id, prompt_version)
);

-- Chunked content for retrieval + grounded chat
create table document_chunks (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid references documents not null,
  chunk_index       integer not null,
  chunk_text        text not null,
  char_offset_start integer,
  char_offset_end   integer,
  embedding         vector(1536),

  unique(document_id, chunk_index)
);

-- Per-user item state (the user's relationship to a document)
create table user_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users not null,
  document_id       uuid references documents not null,
  original_url      text not null,           -- URL as saved (before canonicalization)

  -- Status
  status            text default 'inbox',    -- inbox/stack/reading/finished/archived
  completion_depth  text,                    -- null/previewed/summary_complete/full_read

  -- Surfacing signals
  times_surfaced    integer default 0,
  last_surfaced_at  timestamptz,
  last_passed_at    timestamptz,
  snoozed_until     timestamptz,

  -- Timestamps
  saved_at          timestamptz default now(),
  started_at        timestamptz,
  finished_at       timestamptz,

  -- Processing
  processing_status text default 'queued',   -- queued/processing/ready/failed

  unique(user_id, document_id)
);

-- User highlights & annotations
create table highlights (
  id                uuid primary key default gen_random_uuid(),
  user_item_id      uuid references user_items not null,
  user_id           uuid references auth.users not null,

  -- Anchor (robust against extraction changes)
  quote_text        text not null,           -- the highlighted text
  quote_context     text,                    -- surrounding text for fuzzy re-anchoring
  char_offset_start integer,                 -- offset in clean_text (best-effort)
  char_offset_end   integer,

  note              text,                    -- user annotation
  created_at        timestamptz default now()
);

-- Collections (user-created groupings)
create table collections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users not null,
  name              text not null,
  description       text,
  created_at        timestamptz default now()
);

create table user_item_collections (
  user_item_id      uuid references user_items,
  collection_id     uuid references collections,
  primary key (user_item_id, collection_id)
);

-- Processing jobs (async pipeline tracking)
create table processing_jobs (
  id                uuid primary key default gen_random_uuid(),
  user_item_id      uuid references user_items not null,
  document_id       uuid references documents,
  job_type          text not null,           -- 'extraction' | 'enrichment' | 'embedding' | 'archival'
  status            text default 'pending',  -- pending/running/completed/failed
  attempts          integer default 0,
  last_error        text,
  created_at        timestamptz default now(),
  started_at        timestamptz,
  completed_at      timestamptz
);

-- Interaction events (for ranking model feedback)
create table interaction_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users not null,
  user_item_id      uuid references user_items,
  event_type        text not null,           -- 'keep' | 'pass' | 'more_like_this' | 'open_quick_take' | 'open_summary' | 'open_full' | 'enough_for_now' | 'finished'
  context           jsonb,                   -- {intent_mode, session_id, position_in_stack}
  created_at        timestamptz default now()
);

-- Indexes
create index on document_chunks using hnsw (embedding vector_cosine_ops);
create index on user_items (user_id, status);
create index on user_items (user_id, processing_status);
create index on documents using gin (to_tsvector('english', clean_text));
create index on document_ai using gin (tone_tags);
create index on document_ai using gin (topic_tags);
create index on interaction_events (user_id, created_at);

-- Row Level Security
alter table user_items enable row level security;
alter table highlights enable row level security;
alter table collections enable row level security;
alter table user_item_collections enable row level security;
alter table interaction_events enable row level security;
-- documents and document_ai are shared; access gated through user_items joins
```

### Key Data Model Decisions

- **Documents are shared and deduplicated** by canonical URL. Two users saving the same article share the extraction and AI enrichment — saves cost and processing time.
- **user_items is the user's relationship** to a document: status, completion, surfacing history, snooze state. This is what syncs across devices.
- **document_ai is versioned** by model + prompt. When we improve the enrichment prompt, we can reprocess without losing the old data.
- **Highlights use quote anchors + context**, not raw character offsets alone. Offsets are best-effort but the quote text + surrounding context allows fuzzy re-anchoring when extraction changes.
- **interaction_events** capture the feedback loop for improving ranking over time.

---

## Tech Stack

```
┌──────────────────────────────────────────────────────┐
│                    Frontend                           │
│  Expo (React Native) — iOS + Android + Web           │
│  • Expo Router (file-based navigation)               │
│  • React Native Reanimated (paper stack animations)  │
│  • React Native Gesture Handler (swipe/tap)          │
│  • Custom reader component                           │
│  • expo-sqlite (local offline cache)                 │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│                    Backend                            │
│  Supabase (PostgreSQL + Auth + Storage + Realtime)   │
│  • pgvector extension (embedding similarity search)  │
│  • Edge Functions (ingestion, orchestration)          │
│  • Row Level Security (multi-tenant by default)      │
│  • Realtime subscriptions (sync across devices)      │
│  Runtime: Bun                                        │
└────────────────────────┬─────────────────────────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
     ┌────────────┐ ┌─────────┐ ┌──────────┐
     │ Readability │ │ LLM API │ │ Embedding│
     │ (extract)   │ │ (Claude │ │ API      │
     │ + Jina      │ │  Haiku/ │ │ (OpenAI) │
     │  fallback   │ │  GPT-4o │ └──────────┘
     └────────────┘ │  mini)  │
                    └─────────┘

┌──────────────────────────────────────────────────────┐
│                Background Workers                     │
│  Inngest / Trigger.dev / BullMQ (on Bun)             │
│  • Article extraction                                │
│  • LLM enrichment                                    │
│  • Embedding generation                              │
│  • Archival snapshots                                │
│  • Import processing (bulk)                          │
└──────────────────────────────────────────────────────┘
```

### Why This Stack

- **Supabase** collapses auth, relational DB, vector search, file storage, edge functions, and realtime sync into one managed service. For a solo developer, this is minimum-complexity.
- **Expo** gives iOS + Android + Web from one codebase. The early wedge includes mobile share sheet and offline reading, so going native from the start is justified.
- **Bun** for worker runtime — fast, good DX, native TypeScript.
- **pgvector** — no separate vector DB needed. At personal scale (<10K articles per user), it handles similarity search trivially.

---

## Offline & Sync (Directional)

Offline reading is essential for a read-later app — people read on planes, subways, and in dead zones. The sync model needs to be right from the architecture phase, even if full implementation is phased.

### Principles

1. **Read-heavy, write-light.** Users mostly read offline. Writes are: status changes, highlights, notes, new URL saves. Conflict surface is small.
2. **Local-first for reading.** Articles in the user's Stack/Reading list are cached locally with their Quick Take and Summary. Full offline reading without network.
3. **Server-authoritative for enrichment.** AI processing always happens server-side. Local cache receives results via sync.
4. **Last-write-wins for most fields.** Status changes, completion depth, timestamps — LWW is fine. Highlights and notes are append-only, so conflicts are rare.

### Architecture (directional)

- **Local DB:** `expo-sqlite` stores a subset of `user_items`, `documents`, `document_ai`, and `highlights` for offline access
- **Sync trigger:** On app foreground, pull changes since last sync timestamp. Supabase Realtime for live updates when online.
- **Offline queue:** Saves, status changes, and highlights are queued locally and flushed on reconnect.
- **Cache strategy:** Auto-cache items in Stack and Reading status. User can manually cache others. Respect device storage limits.
- **Conflict resolution:** LWW with server timestamp for status fields. Highlights/notes are CRDTs or append-only (no conflict). Document content is immutable after extraction (no conflict).

### Key Decisions to Make During Implementation

- Exact local DB schema (mirror of server or denormalized for read performance?)
- Sync protocol: polling vs. Supabase Realtime channels vs. hybrid
- Storage budget per device and eviction policy
- Whether to use an existing sync library (e.g., PowerSync, ElectricSQL) or roll a simple one

---

## Screens (Wire-level Descriptions)

### Home — "For This Moment"
```
┌──────────────────────────────────┐
│  memmi                      [≡]  │
│                                  │
│  What do you have room for?      │
│                                  │
│  [5 min] [15 min] [Deep Focus]   │
│  [Learn] [Reflect] [Catch Up]    │
│  [Surprise Me]                   │
│                                  │
│  ┌─ or describe ──────────────┐  │
│  │  "something about design"  │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │                            │  │
│  │  The Bitter Lesson         │  │
│  │  richsutton.com · 8 min   │  │
│  │  Reflective · Essay        │  │
│  │                            │  │
│  │  Argues that general       │  │
│  │  methods leveraging        │  │
│  │  computation win over      │  │
│  │  hand-crafted approaches   │  │
│  │                            │  │
│  │  [Keep]          [Pass]    │  │
│  │       [More like this]     │  │
│  └────────────────────────────┘  │
│    ╌╌╌ ╌╌╌ ╌╌╌  (paper stack)   │
│                                  │
│  [Home]                  [Lib]   │
└──────────────────────────────────┘
```

### Reader — Progressive Depth
```
┌──────────────────────────────────┐
│  ← Back              [⋯]        │
│                                  │
│  The Bitter Lesson               │
│  Rich Sutton · richsutton.com    │
│  8 min · Reflective · Essay      │
│                                  │
│  ┌─ Quick Take ──────────────┐   │
│  │                           │   │
│  │ • General methods that    │   │
│  │   leverage computation    │   │
│  │   ultimately dominate ¹   │   │
│  │                           │   │
│  │ • Researchers repeatedly  │   │
│  │   build in domain         │   │
│  │   knowledge, only to be   │   │
│  │   surpassed by search     │   │
│  │   and learning ²          │   │
│  │                           │   │
│  │ • The "bitter lesson" is  │   │
│  │   that our minds are      │   │
│  │   the bottleneck, not     │   │
│  │   our methods ³           │   │
│  │                           │   │
│  │  ¹²³ tap to see source    │   │
│  └───────────────────────────┘   │
│                                  │
│  [Enough for now]                │
│                                  │
│       [▼ Read Summary]           │
│       [▼ Read Original]          │
│       [Ask Memmi]                │
│                                  │
│  [Mark finished]                 │
└──────────────────────────────────┘
```

### Library
```
┌──────────────────────────────────┐
│  Library               [🔍] [+]  │
│                                  │
│  [Inbox] [Stack] [Reading]       │
│  [Finished] [Collections]        │
│                                  │
│  ┌─ Search ───────────────────┐  │
│  │  articles about climate... │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ The Bitter Lesson          │  │
│  │ richsutton.com · 8 min    │  │
│  │ Reflective · Essay         │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ How to Do Great Work       │  │
│  │ paulgraham.com · 15 min   │  │
│  │ Instructional · Essay      │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ Attention Is All You Need  │  │
│  │ arxiv.org · 25 min        │  │
│  │ Technical · Research       │  │
│  └────────────────────────────┘  │
│                                  │
│  [Home]                  [Lib]   │
└──────────────────────────────────┘
```

---

## Implementation Phases

### Phase 0: Design & Feel (1–2 weeks)

Before building features, nail the aesthetic and interaction feel.

- Design system: color palette, typography, spacing, motion language
- Paper stack card prototype (Reanimated + Gesture Handler)
- Reader typography and progressive disclosure prototype
- Test with static content — does it feel calm, bookish, trustworthy?
- Iterate until the cards feel like paper, not like a feed

This phase produces the visual and interaction foundation everything else builds on.

### Phase 1: Core Loop (MVP)

The minimum to validate: save → enrich → browse → read.

- Supabase project setup (auth, DB with schema above, RLS policies, storage)
- URL save via paste (+ mobile share sheet via Expo)
- Processing pipeline: Readability extraction → LLM enrichment → embedding
- Background worker queue (Inngest or Trigger.dev)
- Progressive reader (Quick Take + Summary + Original)
- Library with Inbox/Stack/Reading/Finished views
- Basic "For This Moment" home with intent selectors
- Simple ranking (time constraint + semantic match + neglectedness)
- **Browser clipper v1** — MV3 extension, URL + title save, one-click
- **Import** — Pocket/Instapaper/Omnivore file import, queued processing
- **Offline reading** — cache Stack/Reading items locally via expo-sqlite
- Basic sync: pull on foreground, offline write queue

### Phase 2: Discovery & Personalization

- Paper stack card interaction polish
- "More like this" (nearest neighbors in embedding space)
- Free-text intent search (embed query → cosine similarity)
- "Surprise Me" (random walk through embedding space)
- Feedback loop: keep/pass/completion signals improve ranking
- Today's Stack as a persistent session concept
- Emergent shelves in Library (lightweight clustering for suggestions)
- Smart collections

### Phase 3: Rich Reading & Trust

- Full DOM capture in browser extension (paywalled content)
- Ask Memmi (grounded article Q&A with source citations)
- Highlight & annotation system
- Text-to-speech
- Archival mode (opt-in raw snapshots)
- "Source unavailable" detection and display
- Export to Readwise, Notion, Obsidian

### Phase 4: Native Polish & Growth

- Native mobile polish (iOS + Android specific affordances)
- Push notifications ("3 pieces that match your morning energy")
- Multi-device sync hardening
- Sharing and social features (share a Quick Take, reading lists)
- Self-hosted option documentation (Supabase self-host + Ollama)

---

## Success Metrics

Track the product like a reading system, not a storage system.

### Capture & Processing
- Capture success rate (% of URLs that produce a usable document)
- Median time from save to enriched card
- Extraction quality score distribution

### Reading & Engagement
- % of saved items that reach Quick Take view
- % that reach Summary view
- % that reach Full Read
- "Enough for now" vs "Mark finished" ratio (both are success)
- Save-to-read conversion within 7 days and 30 days

### Discovery
- Weekly session count (Home → select intent → browse stack)
- Keep rate per session (keeps / cards surfaced)
- "More like this" usage
- Free-text search usage vs. intent selector usage

### Retention
- Weekly active readers (users who read at least one Quick Take)
- Backlog growth rate vs. completion rate
- 30-day retention

---

## Open Decisions

1. **Embedding dimensions:** 1536 (default) vs. 768 (smaller, cheaper storage). Benchmark quality difference at our scale before committing.

2. **Worker infrastructure:** Inngest vs. Trigger.dev vs. BullMQ on Bun. Evaluate based on Supabase integration, retry semantics, and DX.

3. **Sync library:** Build simple polling sync vs. adopt PowerSync/ElectricSQL. Depends on how complex offline gets in practice.

4. **AGPL boundaries:** SingleFile, Omnivore, and Karakeep are all AGPL. Reference patterns freely, but get licensing clarity before shipping any derived code in a hosted product.

5. **Privacy stance on LLM processing:** Decide early whether content from authenticated captures (paywalled articles) flows through hosted LLM providers. Make this visible in settings.

6. **Brand/naming clearance:** There is an existing product at memmi.app. Do trademark/domain review before design work goes too far.

---

## Key Design Principles

1. **Summaries first, full articles second.** Default to the least content needed to make a decision. Summary-level completion is a valid outcome.

2. **Every claim has a source.** Generated content is traceable. Trust is earned through transparency, not hidden behind "AI magic."

3. **Every save feels instant.** Processing is background. The card appears immediately; enrichment populates within seconds.

4. **Actions are forgiving.** "Pass" doesn't delete — it deprioritizes. Everything is recoverable. Low-stakes interaction encourages exploration.

5. **AI is invisible infrastructure, not a feature.** Users don't see "AI-powered" badges. They see a reading app that understands what they want.

6. **The app should feel like a book, not a feed.** Paper textures, generous margins, editorial typography, finite sessions. Calm, not addictive.

---

## References

### Content Extraction
| Tool | Role | License |
|------|------|---------|
| [@mozilla/readability](https://github.com/mozilla/readability) | Primary article extractor | Apache-2.0 |
| [Jina Reader](https://jina.ai/reader/) | Hostile site fallback | Free tier / API key |
| [Playwright](https://playwright.dev/) | JS-heavy site fallback (Phase 2+) | Apache-2.0 |
| [SingleFile](https://github.com/gildas-lormeau/SingleFile) | Full-page archival (Phase 3) | AGPL-3.0 |

### AI & Embeddings
| Tool | Role | Cost |
|------|------|------|
| Claude Haiku / GPT-4o mini | Structured enrichment | ~$0.001/article |
| OpenAI text-embedding-3-small | Article + chunk embeddings | ~$0.02/M tokens |
| Claude Sonnet / GPT-4o | On-demand grounded chat (L4) | ~$0.02/conversation |
| Ollama + local models | Self-hosted alternative | Free |

### Infrastructure
| Tool | Role |
|------|------|
| [Supabase](https://supabase.com) | Auth, DB (pgvector), storage, edge functions, realtime |
| [Expo](https://expo.dev) | Cross-platform app (iOS, Android, Web) |
| [Bun](https://bun.sh) | Worker runtime |
| pgvector | Vector similarity search in PostgreSQL |

### Reference Implementations (patterns, not code)
| Project | What to Learn From It | License |
|---------|----------------------|---------|
| [Karakeep](https://github.com/karakeep-app/karakeep) | Extension, SingleFile integration, Ollama AI tagging, import | AGPL-3.0 |
| [Omnivore](https://github.com/omnivore-app/omnivore) | DOM capture, Readability fork, full-stack architecture | AGPL-3.0 |
| [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox) | Multi-format archival strategies | MIT |
