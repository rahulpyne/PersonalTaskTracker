# Personal Task Tracker

A calm, focused task manager built with Vite + React + Supabase.

## Stack
- **Vite + React 18** — fast dev experience
- **Supabase** — Postgres + Realtime subscriptions
- **Framer Motion** — fluid animations
- **Chart.js** — productivity insights

## Getting Started

```bash
npm install
cp .env.example .env.local
# fill in your Supabase URL and anon key
npm run dev
```

## Supabase Setup

Run `supabase/schema.sql` in your Supabase SQL editor to create tables, RLS policies, and seed data.

## Deploy to Vercel

1. Connect your GitHub repo in Vercel
2. Set env vars: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
3. Deploy — `vercel.json` handles SPA routing automatically
