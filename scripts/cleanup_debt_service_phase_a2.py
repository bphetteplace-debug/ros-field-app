"""Phase A.2 cleanup — add the entries the bank revealed missing.

Inserts:
1. 9 missing AmEx payoffs as Debt Service (diff bank ACH PMT vs DB American
   Express rows, amount-bag matching since DB dates are wrong but amounts
   are accurate)
2. 5 monthly Fundbox principal rows (Debt Service) — total $67,968.70.
   Each = sum of bank ADV DEBITs for the month minus matching interest
   payments (already in DB).
3. 9 American Momentum equipment financing rows (Debt Service) — total
   $48,100. BMS controllers per owner.
4. 2 Carvana vehicle down payment rows (Debt Service) — total $10,990.
5. 2 corrective check rows: #1047 Apr 21 $8,500 lease termination (Other),
   #1048 May 13 $4,700 crane/boom lift rental (Other).

Read-only on existing rows. New inserts only. imported_from tags allow
idempotency.

Usage:
  $env:SUPABASE_SERVICE_KEY = "<service key>"
  python scripts/cleanup_debt_service_phase_a2.py
"""
import os
import sys
import json
import urllib.request
import urllib.error
from collections import Counter
from datetime import datetime
from pathlib import Path
import xlrd

BANK_XLS = r'C:\Users\bphet\Downloads\AccountHistory.xls'
SUPABASE_URL = "https://idddbbvotykfairirmwn.supabase.co"
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
if not SERVICE_KEY:
    print('SUPABASE_SERVICE_KEY env var required')
    sys.exit(1)


def headers(prefer=None):
    h = {'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json'}
    if prefer:
        h['Prefer'] = prefer
    return h


def get(path):
    req = urllib.request.Request(SUPABASE_URL + '/rest/v1/' + path, headers=headers())
    return json.loads(urllib.request.urlopen(req).read())


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


def excel_date_to_iso(v):
    if isinstance(v, (int, float)) and v > 0:
        return xlrd.xldate_as_datetime(v, 0).date().isoformat()
    return None


# ---------------------------------------------------------------------------
# Phase A: parse bank file
# ---------------------------------------------------------------------------
print('=== Reading bank XLS ===')
wb = xlrd.open_workbook(BANK_XLS)
sh = wb.sheet_by_index(0)
bank_txns = []
for r in range(1, sh.nrows):
    row = [sh.cell_value(r, c) for c in range(sh.ncols)]
    bank_txns.append({
        'date': excel_date_to_iso(row[1]),
        'desc': str(row[3] or ''),
        'debit': float(row[4]) if row[4] not in ('', None) else 0.0,
        'credit': float(row[5]) if row[5] not in ('', None) else 0.0,
    })
print(f'  Parsed {len(bank_txns)} bank transactions')


# ---------------------------------------------------------------------------
# Phase B: identify 9 missing AmEx payoffs
# ---------------------------------------------------------------------------
print('\n=== Phase B: identify missing AmEx payoffs ===')

bank_amex = [t for t in bank_txns if 'ACH PMT    AMEX EPAYMENT' in t['desc']]
print(f'  Bank AmEx payoffs: {len(bank_amex)} txns  ${sum(t["debit"] for t in bank_amex):,.2f}')

db_amex = get('monthly_expenses?description=ilike.American*&category=eq.Debt%20Service&select=id,date,amount,description')
print(f'  DB AmEx Debt Service: {len(db_amex)} rows  ${sum(float(r["amount"]) for r in db_amex):,.2f}')

# Match by amount-bag (Counter). DB dates are unreliable but amounts are accurate.
# 4-decimal rounding to handle float precision issues.
def amt_key(a): return round(float(a), 2)

bank_bag = Counter(amt_key(t['debit']) for t in bank_amex)
db_bag = Counter(amt_key(r['amount']) for r in db_amex)
missing_bag = bank_bag - db_bag

# Reconstruct: which bank txns map to the missing amounts? Sort bank by date asc
# and pop them off in order; the leftovers after subtracting DB matches are
# what we need to insert.
unmatched_bank = []
db_bag_copy = Counter(db_bag)
for t in sorted(bank_amex, key=lambda x: x['date']):
    a = amt_key(t['debit'])
    if db_bag_copy.get(a, 0) > 0:
        db_bag_copy[a] -= 1
    else:
        unmatched_bank.append(t)

print(f'  Unmatched bank AmEx (will insert): {len(unmatched_bank)} txns  ${sum(t["debit"] for t in unmatched_bank):,.2f}')
for t in unmatched_bank:
    print(f'    {t["date"]}  ${t["debit"]:>10,.2f}')

amex_new_rows = [
    {
        'date': t['date'],
        'description': 'American Express',
        'amount': round(t['debit'], 2),
        'category': 'Debt Service',
        'notes': 'AmEx ACH payoff per bank statement (added 2026-05-16 Phase A.2 reconciliation)',
        'vendor': 'American Express',
        'month_year': t['date'][:7],
        'imported_from': 'bank_reconcile_2026_05_16',
    }
    for t in unmatched_bank
]


# ---------------------------------------------------------------------------
# Phase C: Fundbox monthly principal rows
# ---------------------------------------------------------------------------
print('\n=== Phase C: Fundbox monthly principal rows ===')

bank_fb = [t for t in bank_txns if 'ADV DEBIT  Fundbox' in t['desc']]
# Sum bank ACH by month
fb_by_month_ach = {}
for t in bank_fb:
    m = t['date'][:7]
    fb_by_month_ach[m] = fb_by_month_ach.get(m, 0) + t['debit']

# Sum interest by month from DB (the rows we inserted earlier)
db_interest = get("monthly_expenses?vendor=eq.Fundbox&imported_from=eq.fundbox_cleanup_2026_05_16&select=date,amount")
fb_by_month_int = {}
for r in db_interest:
    m = r['date'][:7]
    fb_by_month_int[m] = fb_by_month_int.get(m, 0) + float(r['amount'])

fb_principal_rows = []
print(f'  {"month":<10} {"bank ACH $":>14} {"interest $":>14} {"principal $":>14}')
for m in sorted(fb_by_month_ach.keys()):
    ach = fb_by_month_ach[m]
    interest = fb_by_month_int.get(m, 0)
    principal = ach - interest
    print(f'  {m:<10} {ach:>14,.2f} {interest:>14,.2f} {principal:>14,.2f}')
    # Date row at last day of month for clarity
    year, month = m.split('-')
    # Use the 28th as a safe end-of-month date (no calendar lookup)
    fb_principal_rows.append({
        'date': f'{m}-28',
        'description': f'Fundbox loan principal repayment - {m}',
        'amount': round(principal, 2),
        'category': 'Debt Service',
        'notes': f'Monthly principal portion of Fundbox ACH debits. Total ACH ${ach:,.2f} minus interest ${interest:,.2f} (interest already booked as deductible opex per bank-reconcile 2026-05-16).',
        'vendor': 'Fundbox',
        'month_year': m,
        'imported_from': 'bank_reconcile_2026_05_16',
    })


# ---------------------------------------------------------------------------
# Phase D: American Momentum equipment financing rows
# ---------------------------------------------------------------------------
print('\n=== Phase D: American Momentum (BMS equipment financing) ===')

bank_am = [t for t in bank_txns if 'American Momentu' in t['desc']]
print(f'  Bank American Momentum: {len(bank_am)} txns  ${sum(t["debit"] for t in bank_am):,.2f}')
for t in bank_am:
    print(f'    {t["date"]}  ${t["debit"]:>10,.2f}  {t["desc"][:50]}')

am_rows = [
    {
        'date': t['date'],
        'description': t['desc'].strip()[:120],
        'amount': round(t['debit'], 2),
        'category': 'Debt Service',
        'notes': 'BMS controller equipment financing per owner. VERIFY WITH CPA: capitalize as Fixed Asset + depreciate, vs Sec 179 / bonus depreciation expense election. Either way, principal portion of this payment is not directly deductible.',
        'vendor': 'American Momentum',
        'month_year': t['date'][:7],
        'imported_from': 'bank_reconcile_2026_05_16',
    }
    for t in bank_am
]


# ---------------------------------------------------------------------------
# Phase E: Carvana vehicle down payments
# ---------------------------------------------------------------------------
print('\n=== Phase E: Carvana vehicle down payments ===')

bank_cv = [t for t in bank_txns if 'Carvana' in t['desc'] or 'CVNA' in t['desc']]
print(f'  Bank Carvana: {len(bank_cv)} txns  ${sum(t["debit"] for t in bank_cv):,.2f}')

cv_rows = [
    {
        'date': t['date'],
        'description': t['desc'].strip()[:120],
        'amount': round(t['debit'], 2),
        'category': 'Debt Service',
        'notes': 'Vehicle down payment per owner. VERIFY WITH CPA: this is part of vehicle cost basis; depreciate as Vehicles asset.',
        'vendor': 'Carvana',
        'month_year': t['date'][:7],
        'imported_from': 'bank_reconcile_2026_05_16',
    }
    for t in bank_cv
]


# ---------------------------------------------------------------------------
# Phase F: Check #1047 + #1048 corrective entries
# ---------------------------------------------------------------------------
print('\n=== Phase F: Outgoing checks (Kalos already in DB as "zKalos") ===')

check_rows = [
    {
        'date': '2026-04-21',
        'description': 'Check #1047 - Lease termination fee',
        'amount': 8500.00,
        'category': 'Other',
        'notes': 'Lease break fee per owner 2026-05-16. Identified via bank reconcile.',
        'vendor': None,
        'month_year': '2026-04',
        'imported_from': 'bank_reconcile_2026_05_16',
    },
    {
        'date': '2026-05-13',
        'description': 'Check #1048 - Crane and boom lift rental',
        'amount': 4700.00,
        'category': 'Other',
        'notes': 'Crane + boom lift rental per owner 2026-05-16. Identified via bank reconcile.',
        'vendor': None,
        'month_year': '2026-05',
        'imported_from': 'bank_reconcile_2026_05_16',
    },
]
for r in check_rows:
    print(f'  {r["date"]}  ${r["amount"]:>10,.2f}  {r["description"]}')


# ---------------------------------------------------------------------------
# Phase G: idempotency check + insert
# ---------------------------------------------------------------------------
print('\n=== Phase G: idempotency check + insert ===')

existing = get("monthly_expenses?imported_from=eq.bank_reconcile_2026_05_16&select=id")
if existing:
    print(f'  ABORT: {len(existing)} rows already inserted with imported_from=bank_reconcile_2026_05_16 — skipping insert')
    sys.exit(0)

all_new = amex_new_rows + fb_principal_rows + am_rows + cv_rows + check_rows
print(f'  Inserting {len(all_new)} new rows total:')
print(f'    AmEx missing payoffs:      {len(amex_new_rows)}  ${sum(r["amount"] for r in amex_new_rows):,.2f}')
print(f'    Fundbox monthly principal: {len(fb_principal_rows)}  ${sum(r["amount"] for r in fb_principal_rows):,.2f}')
print(f'    American Momentum:         {len(am_rows)}  ${sum(r["amount"] for r in am_rows):,.2f}')
print(f'    Carvana:                   {len(cv_rows)}  ${sum(r["amount"] for r in cv_rows):,.2f}')
print(f'    Checks #1047 + #1048:      {len(check_rows)}  ${sum(r["amount"] for r in check_rows):,.2f}')

inserted = post('monthly_expenses', all_new)
print(f'  INSERTed {len(inserted)} rows')


# ---------------------------------------------------------------------------
# Phase H: verify final totals
# ---------------------------------------------------------------------------
print('\n=== Phase H: post-insert verification ===')

def sum_amount(rows):
    return sum(float(r.get('amount') or 0) for r in rows)

cats = {}
for c in ('Other', 'Fixed', 'Payroll', 'Debt Service'):
    rows = get(f'monthly_expenses?category=eq.{c.replace(" ", "%20")}&select=amount')
    cats[c] = (len(rows), sum_amount(rows))

for c, (n, s) in cats.items():
    print(f'  {c:<15} {n:>5} rows  ${s:>14,.2f}')

deductible = cats['Other'][1] + cats['Fixed'][1] + cats['Payroll'][1]
nondeductible = cats['Debt Service'][1]
print(f'\n  Deductible opex:      ${deductible:>14,.2f}')
print(f'  Debt Service:         ${nondeductible:>14,.2f}')

print('\nDone.')
