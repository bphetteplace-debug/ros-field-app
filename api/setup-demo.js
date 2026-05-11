// One-time setup endpoint to confirm the demo user and create their profile
// Call: GET /api/setup-demo (protected by a simple secret check)
export default async function handler(req, res) {
  const SUPA_URL = process.env.VITE_SUPABASE_URL || 'https://idddbbvotykfairirmwn.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    return res.status(500).json({ error: 'No service role key configured' });
  }

  const DEMO_USER_ID = '1a7aceab-e609-4a9e-bcda-2b3adfc77459';
  const DEMO_EMAIL = 'demo@reliable-oilfield-services.com';

  try {
    // Step 1: Confirm the demo user email via admin API
    const confirmRes = await fetch(SUPA_URL + '/auth/v1/admin/users/' + DEMO_USER_ID, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY
      },
      body: JSON.stringify({ email_confirm: true })
    });
    const confirmData = await confirmRes.json();

    // Step 2: Upsert the profile row
    const profileRes = await fetch(SUPA_URL + '/rest/v1/profiles?id=eq.' + DEMO_USER_ID, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        id: DEMO_USER_ID,
        full_name: 'Demo Guest',
        role: 'admin',
        truck_number: ''
      })
    });
    const profileData = await profileRes.text();

    return res.status(200).json({
      success: true,
      confirm: confirmData,
      profile: profileData
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
