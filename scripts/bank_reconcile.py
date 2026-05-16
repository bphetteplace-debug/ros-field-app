"""Reconcile bank account YTD against monthly_expenses.

Parses C:/Users/bphet/Downloads/AccountHistory.xls (binary .xls from the bank)
using xlrd, applies a description-based categorizer, sums by category, then
fetches monthly_expenses from Supabase and prints side-by-side variances.

Read-only. No DB writes.

Usage:
  $env:SUPABASE_SERVICE_KEY = "<service key>"
  python scripts/bank_reconcile.py
"""
import os
import sys
import json
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime
import xlrd

BANK_XLS = r'C:\Users\bphet\Downloads\AccountHistory.xls'

SUPABASE_URL = "https://idddbbvotykfairirmwn.supabase.co"
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
if not SERVICE_KEY:
    print('SUPABASE_SERVICE_KEY env var required')
    sys.exit(1)


def excel_date_to_iso(v):
    """xlrd returns dates as Excel serial floats. Convert to ISO."""
    if isinstance(v, (int, float)) and v > 0:
        try:
            dt = xlrd.xldate_as_datetime(v, 0)
            return dt.date().isoformat()
        except Exception:
            return None
    return str(v)


# Description patterns -> (bucket, deductibility)
# Order matters: most specific first.
CATEGORIZER = [
    # Revenue (credits, but matching descriptions even on debit side just in case)
    ('ach        DIAMONDBACK E&P',          'Revenue: Diamondback (ACH)',         'revenue'),
    ('SALE       BUENOS WELDING',           'Revenue: Buenos Welding (merchant)', 'revenue'),
    ('SALE       WGL COMPANIES',            'Revenue: WGL Companies (merchant)',  'revenue'),
    ('SALE       NSS MIDLAND',              'Revenue: NSS Midland (merchant)',    'revenue'),
    ('DEPOSIT    INTUIT',                   'Revenue: Intuit merchant card',      'revenue'),
    ('POS CRE',                             'POS credit / refund',                'income_other'),
    ('REFUND',                               'Refund (income/offset)',            'income_other'),
    ('Deposit',                              'Revenue: cash/check deposit',       'revenue'),
    # Debt service (non-deductible)
    ('ACH PMT    AMEX EPAYMENT',            'AmEx payoff',                        'debt_service'),
    ('QBC_PMTS   INTUIT FINANCING',         'QB Capital LOC repayment',           'debt_service'),
    ('Phone/In-Person Transfer Loan',       'Loan transfer (mixed)',              'debt_service'),
    ('From Checking XX1440 to Checking XX6318', 'Internal transfer out',          'transfer'),
    ('From Checking XX6318 to Checking XX1440', 'Internal transfer in',           'transfer'),
    # Loan activity (liability, not expense/income)
    ('ADV CREDIT Fundbox',                  'Fundbox draw (LIABILITY)',           'loan_inflow'),
    ('ADV DEBIT  Fundbox',                  'Fundbox ACH repayment (mixed P+I)',  'debt_service'),
    ('GPWEB LOAN WEBBANK',                  'QB Capital loan inflow (LIABILITY)', 'loan_inflow'),
    # Payroll (deductible)
    ('PAYROLL    INTUIT',                   'Payroll',                            'opex_payroll'),
    ('TAX        INTUIT',                   'Payroll tax',                        'opex_payroll'),
    ('TRAN FEE   INTUIT',                   'Payroll processing fee',             'opex_payroll'),
    ('Accrue 401 ACCRUE401K',               '401k contributions',                 'opex_payroll'),
    # Insurance (fixed deductible)
    ('INSURANCE  FIRST INSURANCE',          'First Insurance',                    'opex_fixed'),
    ('PAYMENTS   J&S INSURANCE',            'J&S Insurance',                      'opex_fixed'),
    ('INSPREMIUM TX MUT INS',               'TX Mutual Insurance',                'opex_fixed'),
    ('PROGRESSIVE INS',                     'Progressive Insurance',              'opex_fixed'),
    # Vehicle / equipment financing — owner needs to clarify whether these are
    # operating expenses (deductible) or capital purchases / loan principal
    # (non-deductible). Leaving as "Equipment financing" flagged for review.
    ('American Momentu',                    'American Momentum equipment finance', 'opex_equipment_review'),
    ('Carvana, L Carvana',                  'Carvana vehicle payment',             'opex_equipment_review'),
    ('CVNA NONRE',                          'Carvana non-refundable shipping',     'opex_equipment_review'),
    # Vendor / utility (Fixed)
    ('ONE STEP GPS',                        'One Step GPS (fleet tracking)',      'opex_fixed'),
    ('VZWRLSS',                             'Verizon Wireless',                   'opex_fixed'),
    ('VERIZON*TELESALE',                    'Verizon (telesale)',                 'opex_fixed'),
    ('VERIZON WRLS',                        'Verizon Wireless',                   'opex_fixed'),
    ('GEXA ENERGY',                         'GEXA Energy (electric)',             'opex_fixed'),
    ('YUKON FAUDREE AFFO',                  'Yukon Faudree (lot rent?)',          'opex_fixed'),
    # Fuel / parts / supplies (Other)
    ('PHILLIPS 66',                         'Phillips 66 (fuel)',                 'opex_other'),
    ('7-ELEVEN',                            '7-Eleven (fuel/supplies)',           'opex_other'),
    ('HOME DEPOT',                          'Home Depot (parts)',                 'opex_other'),
    ('TRACTOR SUPPLY',                      'Tractor Supply',                     'opex_other'),
    ('PTL MIDLAND',                         'PTL Midland (parts?)',               'opex_other'),
    ('THE UPS STORE',                       'UPS Store (shipping)',               'opex_other'),
    # Government / fees
    ('ECTOR VEHREG',                        'Ector County Vehicle Reg',           'opex_fixed'),
    ('TEXAS.GOV*SERVICEFEE',                'Texas service fee',                  'opex_other'),
    ('DD         WEBFILE TAX PYMT',         'Texas state tax payment',            'opex_other'),
    ('8774242366 EnrollAdmin',              'Enrollment admin fee',               'opex_other'),
    # Vendor (likely opex)
    ('PAYMENT    FLAMECO INDUSTRI',         'Flameco Industries (vendor)',        'opex_other'),
    # Catch-all unknowns
    ('Check(C21 Inclearings)',              'Check written (unknown payee)',      'unknown'),
]


def categorize(description):
    d = (description or '').strip()
    for needle, label, bucket in CATEGORIZER:
        if needle in d:
            return label, bucket
    return d[:40], 'unknown'


# ---------------------------------------------------------------------------
# Phase 1: parse bank file
# ---------------------------------------------------------------------------

print(f'Reading {BANK_XLS}...')
wb = xlrd.open_workbook(BANK_XLS)
sheet = wb.sheet_by_index(0)
print(f'  Sheet: {sheet.name}  rows={sheet.nrows}  cols={sheet.ncols}')

txns = []
for r in range(1, sheet.nrows):
    row = [sheet.cell_value(r, c) for c in range(sheet.ncols)]
    acct, post_date, check_no, desc, debit, credit, status = row
    date_iso = excel_date_to_iso(post_date)
    debit = float(debit) if debit not in ('', None) else 0.0
    credit = float(credit) if credit not in ('', None) else 0.0
    txns.append({
        'date': date_iso,
        'desc': desc,
        'debit': debit,
        'credit': credit,
    })

print(f'  Parsed {len(txns)} transactions')
date_min = min(t['date'] for t in txns if t['date'])
date_max = max(t['date'] for t in txns if t['date'])
print(f'  Date range: {date_min} to {date_max}')

# ---------------------------------------------------------------------------
# Phase 2: categorize + sum
# ---------------------------------------------------------------------------

bucket_totals = defaultdict(lambda: {'debit': 0.0, 'credit': 0.0, 'count': 0})
label_totals = defaultdict(lambda: {'debit': 0.0, 'credit': 0.0, 'count': 0})

for t in txns:
    label, bucket = categorize(t['desc'])
    bucket_totals[bucket]['debit'] += t['debit']
    bucket_totals[bucket]['credit'] += t['credit']
    bucket_totals[bucket]['count'] += 1
    label_totals[label]['debit'] += t['debit']
    label_totals[label]['credit'] += t['credit']
    label_totals[label]['count'] += 1

# ---------------------------------------------------------------------------
# Phase 3: print summary
# ---------------------------------------------------------------------------

print('\n=== Bank YTD by bucket ===')
print(f'{"bucket":<28} {"count":>6} {"debits $":>14} {"credits $":>14} {"net $":>14}')
total_debit = total_credit = 0.0
for bucket in sorted(bucket_totals.keys()):
    b = bucket_totals[bucket]
    net = b['credit'] - b['debit']
    print(f'{bucket:<28} {b["count"]:>6} {b["debit"]:>14,.2f} {b["credit"]:>14,.2f} {net:>14,.2f}')
    total_debit += b['debit']
    total_credit += b['credit']
print(f'{"TOTAL":<28} {len(txns):>6} {total_debit:>14,.2f} {total_credit:>14,.2f} {total_credit-total_debit:>14,.2f}')

print('\n=== Bank YTD by label (top 20 by debit) ===')
print(f'{"label":<45} {"count":>5} {"debits $":>14} {"credits $":>14}')
ranked = sorted(label_totals.items(), key=lambda kv: -kv[1]['debit'])
for label, v in ranked[:20]:
    print(f'{label:<45} {v["count"]:>5} {v["debit"]:>14,.2f} {v["credit"]:>14,.2f}')

# Show unknowns explicitly
unknowns = [(t, *categorize(t['desc'])) for t in txns]
unknowns = [(t, l, b) for t, l, b in unknowns if b == 'unknown']
if unknowns:
    print(f'\n=== Unknowns ({len(unknowns)}) — need categorization rules ===')
    seen = set()
    for t, label, bucket in unknowns:
        key = label
        if key in seen:
            continue
        seen.add(key)
        print(f'  {t["date"]} | {t["desc"][:80]:<80} | debit={t["debit"]:,.2f} credit={t["credit"]:,.2f}')

# ---------------------------------------------------------------------------
# Phase 4: compute YTD cash-basis P&L (deductible only)
# ---------------------------------------------------------------------------

opex_debit = (
    bucket_totals['opex_payroll']['debit']
    + bucket_totals['opex_fixed']['debit']
    + bucket_totals['opex_other']['debit']
)
revenue = bucket_totals['revenue']['credit']
debt_service = bucket_totals['debt_service']['debit']
loan_inflow = bucket_totals['loan_inflow']['credit']
equipment_review = bucket_totals['opex_equipment_review']['debit']

print('\n=== Bank-derived YTD P&L (cash basis, deductible only) ===')
print(f'  Revenue (cash received):          ${revenue:>14,.2f}')
print(f'  Payroll (incl. tax + 401k + fees): ${bucket_totals["opex_payroll"]["debit"]:>14,.2f}')
print(f'  Fixed opex (insurance, utils, lot):${bucket_totals["opex_fixed"]["debit"]:>14,.2f}')
print(f'  Other opex (fuel/parts/govt):     ${bucket_totals["opex_other"]["debit"]:>14,.2f}')
print(f'  Equipment finance (REVIEW):       ${equipment_review:>14,.2f}')
print(f'  Total deductible opex:            ${opex_debit:>14,.2f}')
print(f'                                    ' + '-' * 16)
net = revenue - opex_debit
print(f'  Cash-basis Net (before equip):    ${net:>14,.2f}')
print(f'  After equip-finance (if all opex):${(net - equipment_review):>14,.2f}')
print()
print(f'  NON-P&L items (informational):')
print(f'    Debt service (CC payoffs + loan principal): ${debt_service:>14,.2f}')
print(f'    Loan inflows (cash IN, not income):         ${loan_inflow:>14,.2f}')
print(f'    Internal transfers (out):  ${bucket_totals["transfer"]["debit"]:>14,.2f}')
print(f'    Internal transfers (in):   ${bucket_totals["transfer"]["credit"]:>14,.2f}')

# ---------------------------------------------------------------------------
# Phase 5: compare to monthly_expenses
# ---------------------------------------------------------------------------

print('\n=== monthly_expenses (Supabase) totals ===')


def get(path):
    req = urllib.request.Request(
        SUPABASE_URL + '/rest/v1/' + path,
        headers={'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


me_all = get('monthly_expenses?select=date,description,amount,category,vendor&limit=5000')
by_cat = defaultdict(lambda: {'count': 0, 'amount': 0.0})
for r in me_all:
    c = r.get('category') or 'NULL'
    by_cat[c]['count'] += 1
    by_cat[c]['amount'] += float(r.get('amount') or 0)
for c in sorted(by_cat.keys()):
    print(f'  {c:<15} {by_cat[c]["count"]:>5} rows  ${by_cat[c]["amount"]:>14,.2f}')

me_deductible = sum(v['amount'] for k, v in by_cat.items() if k != 'Debt Service')
me_debt = by_cat['Debt Service']['amount']
print(f'\n  Deductible opex in DB:            ${me_deductible:>14,.2f}')
print(f'  Debt Service in DB:               ${me_debt:>14,.2f}')

# ---------------------------------------------------------------------------
# Phase 6: variance analysis (the punch line)
# ---------------------------------------------------------------------------

print('\n=== Bank vs DB variance (where to look for missing entries) ===')
bank_opex = opex_debit  # bank's view of deductible opex (excl. equipment review)
diff_opex = bank_opex - me_deductible
print(f'  Bank deductible opex:             ${bank_opex:>14,.2f}')
print(f'  DB deductible opex:               ${me_deductible:>14,.2f}')
print(f'  VARIANCE (bank - DB):             ${diff_opex:>14,.2f}  {"(DB missing entries)" if diff_opex > 0 else "(DB has more — possible double-counting)"}')

bank_debt = debt_service
diff_debt = bank_debt - me_debt
print(f'\n  Bank debt-service total:          ${bank_debt:>14,.2f}')
print(f'  DB Debt Service total:            ${me_debt:>14,.2f}')
print(f'  VARIANCE:                         ${diff_debt:>14,.2f}')

# Customer revenue — accrual vs cash
print('\n  (Revenue comparison requires submissions data — not included in this script)')

# Specific check: Fundbox repayments in bank vs DB
print('\n=== Fundbox check (bank ADV DEBITs vs DB Fundbox interest rows) ===')
fundbox_bank_debits = sum(t['debit'] for t in txns if 'ADV DEBIT  Fundbox' in t['desc'])
fundbox_bank_count = sum(1 for t in txns if 'ADV DEBIT  Fundbox' in t['desc'])
fundbox_db = get("monthly_expenses?vendor=eq.Fundbox&select=date,amount")
fundbox_db_sum = sum(float(r.get('amount') or 0) for r in fundbox_db)
print(f'  Bank Fundbox ADV DEBIT (repayments): {fundbox_bank_count} txns  ${fundbox_bank_debits:>14,.2f}')
print(f'  DB Fundbox interest rows:            {len(fundbox_db)} rows  ${fundbox_db_sum:>14,.2f}')
print(f'  Implied principal (bank - DB interest): ${fundbox_bank_debits - fundbox_db_sum:>14,.2f}')

# Specific check: AmEx payoffs in bank vs DB
print('\n=== AmEx payoff check (bank ACH PMT vs DB American Express Debt Service) ===')
amex_bank = sum(t['debit'] for t in txns if 'ACH PMT    AMEX EPAYMENT' in t['desc'])
amex_bank_count = sum(1 for t in txns if 'ACH PMT    AMEX EPAYMENT' in t['desc'])
amex_db = get("monthly_expenses?description=ilike.American*&category=eq.Debt%20Service&select=date,amount")
amex_db_sum = sum(float(r.get('amount') or 0) for r in amex_db)
print(f'  Bank AmEx ACH payoffs:               {amex_bank_count} txns  ${amex_bank:>14,.2f}')
print(f'  DB American Express Debt Service:    {len(amex_db)} rows  ${amex_db_sum:>14,.2f}')
print(f'  VARIANCE:                            ${amex_bank - amex_db_sum:>14,.2f}')

print('\nDone.')
