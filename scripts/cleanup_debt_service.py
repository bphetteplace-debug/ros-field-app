"""Apply the debt-service reclassification:

1. Back up every matched row to scripts/backup_debt_service_<ts>.json
2. PATCH 31 rows -> category='Debt Service' (28 AmEx + 1 'Repay loan' +
   1 QB LOC $4,371.41 + 1 account-opening 'Loan payment' $100.00)
3. DELETE 17 Fundbox rows (descriptions like 'Fundbox' or
   'Fundbox Draw (loan interest...)'). These are fictional/mislabeled per
   owner's 2026-05-16 Fundbox YTD summary — first real draw was Mar 5,
   so Jan 1 dated rows can't be real activity.
4. POST 19 new Fundbox interest rows representing the real $4,877.17 +
   $52.10 pending = $4,929.27 of YTD interest, dated correctly per
   owner's summary. Stays as category='Other' (interest IS deductible).
5. Print verification: reclassified count, deleted count, inserted count,
   updated Other-bucket total.

Idempotent: re-running this script after success will (a) find zero
American/Repay/LOC/opening rows still in non-Debt-Service categories,
(b) find zero Fundbox-Draw rows to delete, (c) skip inserts that already
exist (imported_from='fundbox_cleanup_2026_05_16').

Usage:
  $env:SUPABASE_SERVICE_KEY = "<service key>"
  python scripts/cleanup_debt_service.py
"""
import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

SUPABASE_URL = "https://idddbbvotykfairirmwn.supabase.co"
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
if not SERVICE_KEY:
    print('SUPABASE_SERVICE_KEY env var required')
    sys.exit(1)


def headers(prefer=None):
    h = {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
    }
    if prefer:
        h['Prefer'] = prefer
    return h


def get(path):
    req = urllib.request.Request(SUPABASE_URL + '/rest/v1/' + path, headers=headers())
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f'GET HTTP {e.code} for {path}: {e.read().decode()[:300]}')
        raise


def patch(path, body, prefer='return=representation'):
    req = urllib.request.Request(
        SUPABASE_URL + '/rest/v1/' + path,
        data=json.dumps(body).encode('utf-8'),
        method='PATCH',
        headers=headers(prefer),
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f'PATCH HTTP {e.code} for {path}: {e.read().decode()[:300]}')
        raise


def delete(path, prefer='return=representation'):
    req = urllib.request.Request(
        SUPABASE_URL + '/rest/v1/' + path,
        method='DELETE',
        headers=headers(prefer),
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f'DELETE HTTP {e.code} for {path}: {e.read().decode()[:300]}')
        raise


def post(path, body, prefer='return=representation'):
    req = urllib.request.Request(
        SUPABASE_URL + '/rest/v1/' + path,
        data=json.dumps(body).encode('utf-8'),
        method='POST',
        headers=headers(prefer),
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f'POST HTTP {e.code} for {path}: {e.read().decode()[:300]}')
        raise


# ---------------------------------------------------------------------------
# Phase 0: collect IDs and back up
# ---------------------------------------------------------------------------

print('=== Phase 0: collect + backup ===')

amex_rows = get('monthly_expenses?description=ilike.American*&select=*')
fundbox_rows = get('monthly_expenses?description=ilike.Fundbox*&select=*')
repay_rows = get('monthly_expenses?description=ilike.Repay%20loan*&select=*')
# Owner: $4,371.41 is the QuickBooks loan line of credit (currently Payroll)
loc_rows = get('monthly_expenses?and=(description.ilike.loan,amount.eq.4371.41)&select=*')
# Owner: $100 is one-time account opening loan (currently Fixed) - description "Loan payment"
opening_rows = get('monthly_expenses?and=(description.ilike.Loan%20payment*,amount.eq.100)&select=*')

print(f'  AmEx (American*):                {len(amex_rows)} rows')
print(f'  Fundbox*:                         {len(fundbox_rows)} rows')
print(f'  Repay loan*:                      {len(repay_rows)} rows')
print(f'  QB LOC (description=loan, $4371.41): {len(loc_rows)} rows')
print(f'  Account opening (Loan payment $100): {len(opening_rows)} rows')

reclassify_rows = amex_rows + repay_rows + loc_rows + opening_rows
delete_rows = fundbox_rows

# Sanity check counts
expected_reclassify = 28 + 1 + 1 + 1  # 31
expected_delete = 17
if len(reclassify_rows) != expected_reclassify:
    print(f'  WARNING: expected {expected_reclassify} reclassify rows, got {len(reclassify_rows)}')
if len(delete_rows) != expected_delete:
    print(f'  WARNING: expected {expected_delete} delete rows, got {len(delete_rows)}')

# Backup
ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
backup_path = Path(__file__).parent / f'backup_debt_service_{ts}.json'
backup_path.write_text(json.dumps({
    'created_utc': datetime.utcnow().isoformat() + 'Z',
    'reclassify_rows': reclassify_rows,
    'delete_rows': delete_rows,
}, indent=2, default=str), encoding='utf-8')
print(f'  Backup written: {backup_path}')
print(f'  Backup size: {backup_path.stat().st_size} bytes')

# ---------------------------------------------------------------------------
# Phase 1: PATCH reclassify rows -> category='Debt Service'
# ---------------------------------------------------------------------------

print('\n=== Phase 1: PATCH category -> Debt Service ===')

reclassify_ids = [r['id'] for r in reclassify_rows]
if reclassify_ids:
    id_list = ','.join(reclassify_ids)
    patched = patch(
        f'monthly_expenses?id=in.({id_list})',
        {'category': 'Debt Service'},
    )
    print(f'  PATCHed {len(patched)} rows to Debt Service')
    total_reclassified = sum(float(r.get('amount') or 0) for r in patched)
    print(f'  Total $ reclassified: ${total_reclassified:,.2f}')
else:
    print('  No rows to reclassify (already done?)')

# ---------------------------------------------------------------------------
# Phase 2: DELETE Fundbox rows
# ---------------------------------------------------------------------------

print('\n=== Phase 2: DELETE Fundbox rows ===')

if delete_rows:
    delete_ids = [r['id'] for r in delete_rows]
    id_list = ','.join(delete_ids)
    deleted = delete(f'monthly_expenses?id=in.({id_list})')
    print(f'  DELETEd {len(deleted)} rows')
    total_deleted = sum(float(r.get('amount') or 0) for r in deleted)
    print(f'  Total $ removed: ${total_deleted:,.2f}')
else:
    print('  No Fundbox rows to delete (already done?)')

# ---------------------------------------------------------------------------
# Phase 3: POST 19 real Fundbox interest rows
# ---------------------------------------------------------------------------

print('\n=== Phase 3: POST real Fundbox interest rows ===')

# From owner's Fundbox YTD summary (2026-05-16)
FUNDBOX_INTEREST = [
    ('2026-01-06', 277.80),
    ('2026-01-13', 277.90),
    ('2026-01-20', 267.38),
    ('2026-01-27', 267.38),
    ('2026-02-03', 267.38),
    ('2026-02-10', 224.24),
    ('2026-02-17', 224.24),
    ('2026-02-24', 210.03),
    ('2026-03-03', 69.56),
    ('2026-03-10', 69.56),
    ('2026-03-17', 382.41),
    ('2026-03-24', 374.88),
    ('2026-03-31', 360.28),
    ('2026-04-07', 353.53),
    ('2026-04-14', 312.65),
    ('2026-04-21', 312.65),
    ('2026-04-28', 312.65),
    ('2026-05-05', 312.65),
    ('2026-05-12', 52.10),  # pending as of 2026-05-16
]

# Check if already inserted (idempotency)
existing_fbi = get("monthly_expenses?imported_from=eq.fundbox_cleanup_2026_05_16&select=id")
if existing_fbi:
    print(f'  {len(existing_fbi)} rows already inserted with imported_from=fundbox_cleanup_2026_05_16 — skipping insert')
else:
    new_rows = []
    for date_iso, amount in FUNDBOX_INTEREST:
        is_pending = date_iso == '2026-05-12'
        new_rows.append({
            'date': date_iso,
            'description': 'Fundbox interest' + (' (pending)' if is_pending else ''),
            'amount': amount,
            'category': 'Other',  # interest IS deductible opex
            'notes': 'Real Fundbox interest payment per owner-provided YTD summary 2026-05-16. Replaces deleted bogus rows.' + (' Pending bank confirmation.' if is_pending else ''),
            'vendor': 'Fundbox',
            'month_year': date_iso[:7],
            'imported_from': 'fundbox_cleanup_2026_05_16',
        })
    inserted = post('monthly_expenses', new_rows)
    print(f'  INSERTed {len(inserted)} rows')
    total_interest = sum(float(r.get('amount') or 0) for r in inserted)
    print(f'  Total $ real interest opex added back: ${total_interest:,.2f}')

# ---------------------------------------------------------------------------
# Phase 4: verify
# ---------------------------------------------------------------------------

print('\n=== Phase 4: verification ===')

# Bucket totals
def sum_amount(rows):
    return sum(float(r.get('amount') or 0) for r in rows)


other = get('monthly_expenses?category=eq.Other&select=amount')
fixed = get('monthly_expenses?category=eq.Fixed&select=amount')
payroll = get('monthly_expenses?category=eq.Payroll&select=amount')
debt = get('monthly_expenses?category=eq.Debt%20Service&select=amount')

print(f'  Other:        {len(other):>4} rows  ${sum_amount(other):>14,.2f}')
print(f'  Fixed:        {len(fixed):>4} rows  ${sum_amount(fixed):>14,.2f}')
print(f'  Payroll:      {len(payroll):>4} rows  ${sum_amount(payroll):>14,.2f}')
print(f'  Debt Service: {len(debt):>4} rows  ${sum_amount(debt):>14,.2f}')

deductible_opex = sum_amount(other) + sum_amount(fixed) + sum_amount(payroll)
print(f'\n  Total deductible opex (excl. Debt Service): ${deductible_opex:,.2f}')
print(f'  Total Debt Service (non-deductible):        ${sum_amount(debt):,.2f}')

# Any AmEx / Fundbox-Draw still lurking?
stragglers_amex = get("monthly_expenses?description=ilike.American*&category=neq.Debt%20Service&select=id,description,amount,category")
stragglers_fb_draw = get("monthly_expenses?description=ilike.Fundbox%20Draw*&select=id,description,amount,category")
if stragglers_amex:
    print(f'\n  WARNING: {len(stragglers_amex)} American* rows still NOT in Debt Service')
    for r in stragglers_amex:
        print(f'    {r}')
else:
    print(f'\n  PASS: zero American* stragglers outside Debt Service')

if stragglers_fb_draw:
    print(f'  WARNING: {len(stragglers_fb_draw)} "Fundbox Draw" rows still present')
else:
    print(f'  PASS: zero "Fundbox Draw" rows remain')

print('\nDone.')
