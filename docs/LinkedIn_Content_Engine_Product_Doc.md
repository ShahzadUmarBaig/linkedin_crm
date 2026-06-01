# LinkedIn Content Engine

## Product Overview

A personal AI-powered tool that helps you post consistently on LinkedIn by feeding you relevant content from your niche, turning that content into post ideas tailored to your voice, helping you plan when to post, and tracking what's working.

---

## Core Flow

```
You set up your profile + connect RSS feeds
              ↓
System pulls new articles daily
              ↓
AI generates post ideas based on articles + your angle
              ↓
You pick an idea → AI writes a draft
              ↓
You schedule it on your calendar
              ↓
You post it on LinkedIn (manually for now)
              ↓
You log the results → system learns what works
```

---

## Features

### 1. Profile Setup

You tell the system who you are and what you post about.

**What you enter:**
- Your expertise (Flutter, AI, Full-Stack, etc.)
- Your content pillars — the 3-4 topics you want to be known for
- Your tone (casual, professional, bold)
- Your target audience (startup founders, CTOs, developers)

**Why it matters:**
Every post idea and draft is generated with this context. It's what makes the output sound like you, not generic AI.

---

### 2. RSS Feeds

You connect newsletters and blogs you already read.

**What you do:**
- Add RSS feed URLs
- Tag them by category (Flutter, AI, Startups, etc.)

**What the system does:**
- Pulls new articles every day
- Stores them for the AI to reference

**Example feeds:**
- Flutter dev newsletter
- Hacker News
- Lenny's Newsletter
- TechCrunch
- AI-specific blogs

---

### 3. Post Ideas

The AI reads new articles + your profile and suggests post ideas.

**What you see:**
- A list of 5-10 post ideas each week
- Each idea has:
  - A hook (the first line)
  - The angle (your unique take)
  - The source (which article inspired it)
  - Which content pillar it fits

**What you do:**
- Approve ideas you like
- Reject ones you don't
- Edit if needed

---

### 4. Draft Writer

You pick an idea, and the AI writes a full post.

**What you get:**
- A ready-to-post LinkedIn draft
- Written in your tone
- 150-300 words
- Formatted for LinkedIn (line breaks, hook first)

**What you do:**
- Edit if needed
- Save to drafts
- Or schedule it

---

### 5. Content Calendar

A simple view of what's scheduled and when.

**What you see:**
- This week's posts
- Which days are covered, which are empty
- Suggested posting times

**What you do:**
- Drag posts to different days
- Set posting time (morning, lunch, evening)
- See at a glance if you're on track for 3x/week

---

### 6. Post Tracking

After you post on LinkedIn, you log the results.

**What you enter:**
- Link to the published post
- Impressions, likes, comments (manually for V1)

**What the system does:**
- Stores performance data
- Shows you which posts performed best
- Over time, identifies patterns (best topics, best times)

---

## What's NOT in V1

| Feature | Why Not |
|:--------|:--------|
| Auto-posting to LinkedIn | LinkedIn API doesn't allow it easily |
| Chrome extension | Nice to have, not essential |
| Fancy analytics dashboard | Simple list is fine for now |
| Team features | It's just for you |

---

## Configuration Options

### Content Pillars (Define 3-4)

Examples:
- Flutter development tips
- AI-assisted development (Claude workflow)
- Startup/founder journey
- Client project case studies
- Hot takes on tech industry

### Tone Options

- Casual and conversational
- Professional but approachable
- Bold and opinionated
- Educational and helpful

### Posting Frequency

- 3x per week (recommended starting point)
- Daily
- 5x per week

---

## User Screens

1. **Dashboard** — Overview of upcoming posts, recent performance, new ideas
2. **Profile Setup** — Configure expertise, pillars, tone, audience
3. **RSS Feeds** — Manage connected feeds, view recent articles
4. **Ideas** — List of AI-generated post ideas to approve/reject
5. **Drafts** — Saved post drafts ready to schedule
6. **Calendar** — Weekly/monthly view of scheduled posts
7. **Analytics** — Performance of published posts, best times, top topics
