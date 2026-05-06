# Week 1: Backend setup

This walks you through provisioning Supabase and switching the app from local mode to cloud mode. ~3–4 hours of work.

---

## Step 1: Create Supabase project

1. Go to [supabase.com](https://supabase.com), sign up (free tier is plenty for now)
2. **New project**:
   - Name: `ros-field-app`
   - Database password: generate a strong one, **save it in 1Password**
   - Region: pick closest to Texas (US East 1 or US West 1)
   - Plan: Free
3. Wait ~2 min for provisioning

---

## Step 2: Run the schema

1. In your Supabase project: **SQL Editor** → **New query**
2. Open `docs/schema.sql` from this repo
3. Paste the entire contents into the SQL Editor
4. Click **Run**

You should see "Success. No rows returned." Check **Table Editor** in the sidebar — you should see 7 tables: `profiles`, `customers`, `locations`, `parts_catalog`, `submissions`, `submission_techs`, `photos`.

---

## Step 3: Seed the parts catalog

1. **Table Editor** → `parts_catalog` → **Insert** → **Import data from CSV**
2. Upload `docs/parts_catalog.csv`
3. Map columns: `code` → code, `desc` → description, `price` → price, `category` → category
4. Import. You should now have 247 rows in `parts_catalog`.

---

## Step 4: Seed customers and locations

In **SQL Editor**, paste and run:

```sql
INSERT INTO customers (name) VALUES
  ('Diamondback'),
  ('High Peak Energy'),
  ('ExTex'),
  ('A8 Oilfield Services'),
  ('Pristine Alliance'),
  ('KOS');

-- Add locations as you encounter them in the field
-- INSERT INTO locations (customer_id, name, work_area) VALUES (...);
```

---

## Step 5: Create user accounts

For each crew member:

1. **Authentication** → **Users** → **Add user** → **Create new user**
2. Enter their email and a temporary password
3. Toggle "Auto Confirm User" so they don't need to verify
4. Repeat for: yourself (admin), Matt, Vlad, Pedro, Caryl

After creating, run this to set their roles and full names. In **SQL Editor**:

```sql
-- Replace UUIDs with the actual user IDs from Authentication → Users
INSERT INTO profiles (id, full_name, role, truck_number) VALUES
  ('<your-uuid>', 'Brian', 'admin', null),
  ('<matt-uuid>', 'Matthew Reid', 'tech', '0003'),
  ('<vlad-uuid>', 'Vladimir Rivero', 'tech', '0001'),
  ('<pedro-uuid>', 'Pedro Perez', 'tech', '0002'),
  ('<caryl-uuid>', 'Caryl Phetteplace', 'admin', null);
```

---

## Step 6: Create the photo storage bucket

1. **Storage** → **New bucket**
2. Name: `submission-photos`
3. Public bucket: **No** (we want photos behind auth)
4. Click **Create**

Then add a storage policy (Storage → submission-photos → Policies → New policy):

```sql
-- Authenticated users can upload to their own folder
CREATE POLICY "Users can upload own photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'submission-photos');

-- Authenticated users can read their own photos
-- (RLS on submissions controls who sees which submission's photos)
CREATE POLICY "Authenticated users can view photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'submission-photos');
```

---

## Step 7: Get your API keys

1. **Settings** → **API**
2. Copy:
   - **Project URL** (looks like `https://xyz.supabase.co`)
   - **anon public** key (long JWT-looking string)

⚠️ The `service_role` key is NOT what you want. Use `anon` only on the client.

---

## Step 8: Set env vars

### Locally
Create `.env.local` in the project root:

```
VITE_SUPABASE_URL=https://xyz.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Restart `npm run dev`. The app should now show the login page instead of the form.

### On Vercel
1. Vercel project → **Settings** → **Environment Variables**
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values)
3. Set **Environments**: Production, Preview, Development (all three)
4. Save
5. **Deployments** → ⋯ → **Redeploy** the latest

After redeploy, your live URL will require login.

---

## Step 9: Test login

Sign in with one of the user accounts you created. You should land on the form. Sign out works. Wrong password fails gracefully.

If something's broken, dev tools → Console → look for errors. Most common:
- Wrong env var key (must start with `VITE_`)
- RLS policy blocking the login (check Authentication logs)
- Forgot to redeploy after setting env vars

---

## What's next

You're now in cloud mode but submissions still don't persist — that's Week 2 (`WEEK2_PERSISTENCE.md` will cover wiring forms to the database).
