/**
 * Newsletter: D1-backed signup with double opt-in and preferences
 * (daily digest / weekly best-of, optional category filter), a daily digest,
 * and a Sunday "Best of the Week" edition driven by real read counts,
 * each with an AI-drafted editor's intro and a "From the Archive" slot.
 */
import { Env, json } from './lib';

const INTRO_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];

export async function newsletter(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === '/api/newsletter/subscribe' && request.method === 'POST') {
    let email = '', frequency = 'daily', categories: string[] = [];
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('json')) {
      const body = (await request.json().catch(() => ({}))) as any;
      email = body.email ?? '';
      if (body.frequency === 'weekly') frequency = 'weekly';
      if (Array.isArray(body.categories)) categories = body.categories.slice(0, 12).map(String);
    } else {
      const form = await request.formData().catch(() => new FormData());
      email = String(form.get('email') ?? '');
      if (form.get('frequency') === 'weekly') frequency = 'weekly';
      categories = form.getAll('categories').slice(0, 12).map(String);
    }
    email = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ message: 'Please enter a valid email address.' }, 400);
    }

    const token = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO subscribers (email, status, token, frequency, categories) VALUES (?, 'pending', ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         token = excluded.token,
         frequency = excluded.frequency,
         categories = excluded.categories,
         status = CASE WHEN subscribers.status = 'confirmed' THEN 'confirmed' ELSE 'pending' END`
    ).bind(email, token, frequency, categories.join(',')).run();

    const row = await env.DB.prepare('SELECT status FROM subscribers WHERE email = ?').bind(email).first<{ status: string }>();
    if (row?.status === 'confirmed') {
      return json({ message: 'Your preferences are saved — you are already subscribed!' });
    }

    const confirmUrl = `${env.SITE_URL}/api/newsletter/confirm?token=${token}`;
    await sendEmail(env, {
      to: email,
      subject: 'Confirm your Intellectual Takeout subscription',
      html: `<p>Thanks for signing up for the Intellectual Takeout newsletter.</p>
             <p><a href="${confirmUrl}">Click here to confirm your subscription.</a></p>
             <p>If you didn't request this, you can ignore this email.</p>`,
    });
    return json({ message: 'Check your inbox to confirm your subscription.' });
  }

  if (path === '/api/newsletter/confirm') {
    const token = url.searchParams.get('token') ?? '';
    const res = await env.DB.prepare(
      `UPDATE subscribers SET status = 'confirmed', confirmed_at = datetime('now') WHERE token = ? AND status != 'unsubscribed'`
    ).bind(token).run();
    const ok = (res.meta.changes ?? 0) > 0;
    return Response.redirect(`${env.SITE_URL}/newsletter/${ok ? 'confirmed' : 'invalid'}/`, 302);
  }

  if (path === '/api/newsletter/unsubscribe') {
    const token = url.searchParams.get('token') ?? '';
    await env.DB.prepare(
      `UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE token = ?`
    ).bind(token).run();
    return Response.redirect(`${env.SITE_URL}/newsletter/unsubscribed/`, 302);
  }

  return json({ error: 'not_found' }, 404);
}

// ---------------------------------------------------------------- shared bits

interface FeedItem { title: string; link: string; description: string; categories: string[]; pubDate: number }

async function feedItems(env: Env): Promise<FeedItem[]> {
  const feed = await env.ASSETS.fetch(new URL('/feed.xml', env.SITE_URL));
  const xml = await feed.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const item = m[1];
    return {
      title: decodeEntities(item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? ''),
      link: item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '',
      description: decodeEntities(item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] ?? ''),
      categories: [...item.matchAll(/<category>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>/g)].map((c) => decodeEntities(c[1])),
      pubDate: new Date(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? 0).getTime(),
    };
  });
}

async function editorIntro(env: Env, titles: string[], edition: string): Promise<string> {
  for (const model of INTRO_MODELS) {
    try {
      const res = (await env.AI.run(model as any, {
        messages: [
          {
            role: 'system',
            content:
              "You write the 2-3 sentence editor's introduction for Intellectual Takeout's email newsletter. Warm, literate, direct; no hype, no emojis, no 'in this issue' boilerplate. Reference the themes of the articles, not a list of them.",
          },
          { role: 'user', content: `Edition: ${edition}. Today's articles:\n${titles.join('\n')}` },
        ],
        max_tokens: 160,
      })) as { response?: string };
      if (res.response) return res.response.trim();
    } catch { /* try next model */ }
  }
  return '';
}

async function archiveSlot(env: Env): Promise<{ url: string; title: string; author: string; year: string } | null> {
  const mmdd = new Date().toISOString().slice(5, 10);
  const row = await env.DB.prepare(
    `SELECT url, title, author, pub_date FROM articles_fts
     WHERE substr(pub_date, 6, 5) = ? AND pub_date < datetime('now', '-2 years')
     ORDER BY RANDOM() LIMIT 1`
  ).bind(mmdd).first<{ url: string; title: string; author: string; pub_date: string }>();
  return row ? { url: row.url, title: row.title, author: row.author, year: row.pub_date.slice(0, 4) } : null;
}

function articleBlock(i: { title: string; link: string; description: string }): string {
  return `<h3 style="margin:18px 0 4px;font-family:Georgia,serif;"><a href="${i.link}" style="color:#1c2a2c;">${i.title}</a></h3><p style="margin:0;color:#333;">${i.description}</p>`;
}

function shell(env: Env, intro: string, body: string, archive: Awaited<ReturnType<typeof archiveSlot>>, unsubscribe: string): string {
  return `
  <div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;font-size:16px;line-height:1.5;">
    <h2 style="font-family:Georgia,serif;border-bottom:3px solid #3c757c;padding-bottom:10px;">Intellectual Takeout</h2>
    ${intro ? `<p style="font-style:italic;color:#2e5c62;">${intro}</p>` : ''}
    ${body}
    ${archive ? `<div style="margin-top:28px;padding:16px;background:#f2f6f5;border-left:4px solid #3c757c;">
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#3c757c;">From the Archive · ${archive.year}</div>
      <a href="${env.SITE_URL}${archive.url}" style="font-family:Georgia,serif;font-size:18px;color:#1c2a2c;">${archive.title}</a>
      <div style="font-size:13px;color:#666;">by ${archive.author}</div></div>` : ''}
    <p style="margin-top:28px;font-size:12px;color:#777;"><a href="${unsubscribe}">Unsubscribe</a> · <a href="${env.SITE_URL}/subscribe/">Update preferences</a></p>
  </div>`;
}

// ---------------------------------------------------------------- editions

export async function sendDailyDigest(env: Env): Promise<void> {
  const items = await feedItems(env);
  const now = Date.now();
  const fresh = items.filter((i) => now - i.pubDate < 24 * 3600 * 1000);
  if (!fresh.length) return;

  const subs = await env.DB.prepare(
    `SELECT email, token, categories FROM subscribers WHERE status = 'confirmed' AND frequency = 'daily'`
  ).all<{ email: string; token: string; categories: string }>();
  if (!subs.results?.length) return;

  const intro = await editorIntro(env, fresh.map((i) => i.title), 'Daily Digest');
  const archive = await archiveSlot(env);

  let sent = 0;
  for (const sub of subs.results) {
    const prefs = (sub.categories || '').split(',').filter(Boolean);
    const mine = prefs.length
      ? fresh.filter((i) => i.categories.some((c) => prefs.includes(c)))
      : fresh;
    if (!mine.length) continue;
    const unsubscribe = `${env.SITE_URL}/api/newsletter/unsubscribe?token=${sub.token}`;
    await sendEmail(env, {
      to: sub.email,
      subject: `Daily Digest: ${mine[0].title}`,
      html: shell(env, intro, mine.map(articleBlock).join(''), archive, unsubscribe),
      headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
    });
    sent++;
  }
  await env.DB.prepare(`INSERT INTO sends (subject, article_count, recipient_count) VALUES (?, ?, ?)`)
    .bind(`Daily Digest: ${fresh[0].title}`, fresh.length, sent).run();
}

export async function sendWeeklyBestOf(env: Env): Promise<void> {
  const since = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
  const top = await env.DB.prepare(
    `SELECT v.path, SUM(v.views) AS views, f.title, f.author, f.description
     FROM page_views v JOIN articles_fts f ON f.url = v.path
     WHERE v.day >= ? GROUP BY v.path ORDER BY views DESC LIMIT 6`
  ).bind(since).all<any>();
  const picks = (top.results ?? []).filter((r) => r.title);
  if (!picks.length) return;

  const subs = await env.DB.prepare(
    `SELECT email, token FROM subscribers WHERE status = 'confirmed'`
  ).all<{ email: string; token: string }>();
  if (!subs.results?.length) return;

  const intro = await editorIntro(env, picks.map((p: any) => p.title), 'Best of the Week');
  const archive = await archiveSlot(env);
  const body = picks
    .map((p: any) => articleBlock({ title: p.title, link: `${env.SITE_URL}${p.path}`, description: p.description ?? '' }))
    .join('');

  let sent = 0;
  for (const sub of subs.results) {
    const unsubscribe = `${env.SITE_URL}/api/newsletter/unsubscribe?token=${sub.token}`;
    await sendEmail(env, {
      to: sub.email,
      subject: `Best of the Week: ${picks[0].title}`,
      html: shell(env, intro, body, archive, unsubscribe),
      headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
    });
    sent++;
  }
  await env.DB.prepare(`INSERT INTO sends (subject, article_count, recipient_count) VALUES (?, ?, ?)`)
    .bind(`Best of the Week: ${picks[0].title}`, picks.length, sent).run();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ---------------------------------------------------------------- email adapter

export async function sendEmail(
  env: Env,
  msg: { to: string; subject: string; html: string; headers?: Record<string, string> }
): Promise<void> {
  const provider = env.EMAIL_PROVIDER ?? 'log';

  if (provider === 'resend' && env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? 'Intellectual Takeout <newsletter@intellectualtakeout.org>',
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        headers: msg.headers,
      }),
    });
    if (!r.ok) console.error('resend error', r.status, await r.text());
    return;
  }

  // 'log' provider: no ESP configured yet — record intent so signups aren't lost.
  console.log(`[email:${provider}] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
}
