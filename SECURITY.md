# Security model

CrowderBoard is a static web app that talks directly to Supabase with the public *publishable* key. Everything a visitor can do is decided by the database, not the browser.

## What the database enforces

| Who | Can | Cannot |
|---|---|---|
| **Guests** | Read and search boards, topics, posts, profiles, site settings; bump view counts | Post, read private messages, change anything |
| **Members** | Start topics (not in staff-only boards), reply to unlocked topics, edit their own posts, delete their own replies, edit their own avatar/signature/location, send and delete their own PMs | Change their role, title or post count; edit others' posts or profiles; read others' PMs; create boards; change site settings; backdate posts or messages |
| **Banned members** | Read like a guest | Post, send PMs, or change their profile |
| **Moderators** (board/category) | Everything members can, plus — only in the boards or categories they were assigned — lock/sticky/delete topics, edit/delete any post, reply to locked topics, start topics in staff-only boards, and move topics between boards they moderate | Moderate anywhere else, move topics out of their area, assign moderators, change roles, boards or site settings |
| **Global Moderators** | Everything members can, plus lock/sticky/move/delete topics and edit/delete any post anywhere; reply to locked topics; assign and remove board/category moderators | Change other roles, boards or site settings |
| **Administrators** | Everything, including boards/categories, roles and bans, Look & Feel, and uploading banner images to the `forum-assets` storage bucket | — |

How:
- **Row-level security** on every `forum_*` table.
- **Column-level grants** so members can only write the content columns (e.g. a post's `thread_id`, `user_id`, `body`) — role, post counts, timestamps and edit stamps are set by the server.
- **Triggers** stamp `created_at`/`edited_at` server-side, keep counters accurate, clamp "last seen" timestamps, and **rate-limit** members (5 posts per minute, 5 PMs per minute, 5 new topics per 10 minutes).
- **`SECURITY DEFINER` functions** for multi-step actions (start a topic, moderate a topic, set a role) check the caller's role first and pin `search_path`.
- Board-moderator assignments live in `forum_board_mods`, readable by everyone but writable only through `forum_add_board_mod` / `forum_remove_board_mod`. Admins and global moderators cannot be assigned, and a member's position reverts to Member when their last assignment is removed.
- The `forum-assets` storage bucket is public to read, accepts JPEGs up to 2 MB, and only administrators can upload, replace or delete files.
- The `anon`/`authenticated` API roles have no `TRUNCATE`, `TRIGGER` or `REFERENCES` privileges, and internal helper functions are not callable from the API.

## In the browser

- Post, PM and signature text is HTML-escaped before BBCode is converted; links must be `http(s)://`, images must be `https://`, and colors/sizes are allow-listed.
- Admin-entered HTML (banner, header, footer) is run through a sanitizer that strips `<script>`, `<iframe>`, `<object>`, forms, `on*` event attributes and `javascript:` URLs. Custom CSS is inserted as text into a `<style>` element.

## Known limits

- **Admins are trusted.** The HTML sanitizer is a reasonable filter, not a guarantee against every browser parsing trick. Only give the Administrator role to people you trust with the whole site.
- **Shared logins.** If your Supabase project also powers other apps on the same domain, members share one login across them, and any script running on that domain could use it. Don't loosen the sanitizer to allow scripts.
- **Spam.** Rate limits slow down a single account but do not stop many accounts. Keep email confirmation on, and consider adding CAPTCHA (Supabase Auth supports hCaptcha/Turnstile).
- **View counts** can be inflated by anyone, since guests are allowed to record views.
- **PM deletion** removes the message for both sender and recipient.
- Avatar and post images load from third-party URLs, which can see the visitor's IP address (images are requested with `referrerpolicy="no-referrer"`).

## Reporting a vulnerability

Please open a GitHub issue **without** exploit details and ask for a private contact, or use GitHub's private vulnerability reporting if it's enabled on the repository.
