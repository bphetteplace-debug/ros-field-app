"""Audit monthly_expenses rows that look like credit-card payoffs or loan
repayments rather than real operating expenses.

Matches (any of):
  - description ILIKE 'American%'  (AmEx card payoffs)
  - description ILIKE 'Fund%'      (Fundbox loan repayments)
  - description ILIKE '%loan%'     (loan principal text anywhere)
  - description ILIKE '%repay%'    (repay text anywhere)

Pulls all matches, prints per-class sample + monthly grouping with running
totals + currently-assigned category breakdown + potential false positives.
Read-only. No UPDATE/DELETE.

Usage:
  $env:SUPABASE_SERVICE_KEY = "<service key>"
  python scripts/audit_debt_service.py
"""
import os
import sys
import json
import urllib.request
import urllib.error
from collections import defaultdict

SUPABASE_URL = "https://idddbbvotykfairirmwn.supabase.co"
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
if not SERVICE_KEY:
    print('SUPABASE_SERVICE_KEY env var required')
    sys.exit(1)


def query(filter_clause):
    url = (
        SUPABASE_URL
        + '/rest/v1/monthly_expenses?'
        + filter_clause
        + '&select=id,date,description,amount,category,month_year,vendor,notes'
        + '&order=date.asc.nullslast'
        + '&limit=2000'
    )
    req = urllib.request.Request(
        url,
        headers={'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        print(f'HTTP {e.code} for filter {filter_clause}: {body}')
        sys.exit(2)


classes = {
    'American (AmEx payoff)': 'description=ilike.American*',
    'Fund (Fundbox)':          'description=ilike.Fund*',
    'loan (description)':      'description=ilike.*loan*',
    'repay (description)':     'description=ilike.*repay*',
}

all_rows = {}
class_membership = defaultdict(set)

for cls, flt in classes.items():
    rows = query(flt)
    print(f'\n=== {cls}: {len(rows)} rows ===')
    for r in rows[:8]:
        desc = (r.get('description') or '')[:55]
        amt = float(r.get('amount') or 0)
        print(f'  {r.get("date") or "????-??-??"} | {desc:<55} | ${amt:>10,.2f} | {r.get("category")}')
    if len(rows) > 8:
        print(f'  ... and {len(rows) - 8} more')
    for r in rows:
        all_rows[r['id']] = r
        class_membership[r['id']].add(cls)

monthly = defaultdict(lambda: {'count': 0, 'amount': 0.0})
for rid, r in all_rows.items():
    m = r.get('month_year') or 'unknown'
    monthly[m]['count'] += 1
    monthly[m]['amount'] += float(r.get('amount') or 0)

print('\n=== Monthly summary (deduplicated across match classes) ===')
print(f'{"month_year":<12} {"count":>6} {"amount $":>14} {"running $":>14}')
running = 0.0
for m in sorted(monthly.keys()):
    running += monthly[m]['amount']
    print(f'{m:<12} {monthly[m]["count"]:>6} {monthly[m]["amount"]:>14,.2f} {running:>14,.2f}')

cat_counts = defaultdict(int)
cat_amounts = defaultdict(float)
for rid, r in all_rows.items():
    cat = r.get('category') or 'NULL'
    cat_counts[cat] += 1
    cat_amounts[cat] += float(r.get('amount') or 0)

print('\n=== Currently tagged as ===')
for c in sorted(cat_counts):
    print(f'  {c:<15} {cat_counts[c]:>5} rows  ${cat_amounts[c]:>14,.2f}')

print(f'\nTotal unique rows matched: {len(all_rows)}')
total_amt = sum(float(r.get('amount') or 0) for r in all_rows.values())
print(f'Total $ that would be reclassified: ${total_amt:,.2f}')

# Rows that matched multiple classes (e.g. "American Express loan repay")
multi = [(rid, sorted(cs)) for rid, cs in class_membership.items() if len(cs) > 1]
if multi:
    print(f'\n=== Multi-class matches ({len(multi)}) ===')
    for rid, cs in multi[:10]:
        r = all_rows[rid]
        print(f'  {r.get("date")} | {(r.get("description") or "")[:45]:<45} | classes: {", ".join(cs)}')

# Flag potential false positives — substring matched but row could be real opex
false_pos_hints = ['supply', 'welding', 'parts', 'service', 'shop', 'oil', 'gas']
fp = []
for rid, r in all_rows.items():
    desc = (r.get('description') or '').lower()
    if any(h in desc for h in false_pos_hints):
        fp.append(r)
if fp:
    print(f'\n=== Potential false positives to review ({len(fp)}) ===')
    for r in fp[:15]:
        print(f'  {r.get("date")} | {(r.get("description") or "")[:55]:<55} | ${float(r.get("amount") or 0):>10,.2f} | {r.get("category")}')

# Also pull totals across the WHOLE monthly_expenses table for context
print('\n=== Total monthly_expenses size (sanity) ===')
all_rows_total = query('select=id&limit=1&select=count')  # PostgREST count via head
# Simpler: just pull all rows count via Range header would be ideal, but quickest is another query
all_other = query('category=eq.Other&select=id,amount,month_year')
all_fixed = query('category=eq.Fixed&select=id,amount,month_year')
all_payroll = query('category=eq.Payroll&select=id,amount,month_year')
for label, rows in [('Other', all_other), ('Fixed', all_fixed), ('Payroll', all_payroll)]:
    tot = sum(float(r.get('amount') or 0) for r in rows)
    print(f'  {label:<10} {len(rows):>5} rows  ${tot:>14,.2f}')
