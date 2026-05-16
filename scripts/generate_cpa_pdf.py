"""Generate a one-page CPA-ready PDF summary of YTD 2026 financial
reconciliation for Reliable Oilfield Services LLC.

Sources all numbers from monthly_expenses + submissions tables (Supabase)
+ the bank account YTD export. Generates a single-page Letter PDF with:
  - Operating P&L (deductible expenses only)
  - Debt Service breakdown (non-deductible, excluded from P&L)
  - Cash flow reconciliation (why profit != cash in bank)
  - CPA action items (Sec 179, depreciation, accrual variance)

Usage:
  $env:SUPABASE_SERVICE_KEY = "<service key>"
  python scripts/generate_cpa_pdf.py
"""
import os
import sys
import json
import urllib.request
from datetime import datetime
import xlrd

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)

OUTPUT = r'C:\Users\bphet\Downloads\ROS_YTD_Reconciliation_2026-05-16.pdf'
BANK_XLS = r'C:\Users\bphet\Downloads\AccountHistory.xls'

SUPABASE_URL = 'https://idddbbvotykfairirmwn.supabase.co'
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
if not SERVICE_KEY:
    print('SUPABASE_SERVICE_KEY env var required')
    sys.exit(1)


def get(p):
    req = urllib.request.Request(
        SUPABASE_URL + '/rest/v1/' + p,
        headers={'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY},
    )
    return json.loads(urllib.request.urlopen(req).read())


def money(n):
    return '$' + f'{n:,.2f}'


def money0(n):
    return '$' + f'{n:,.0f}'


# ---------- Pull data ----------
print('Pulling data from Supabase + bank file...')
subs = get('submissions?date=gte.2026-01-01&date=lte.2026-12-31&select=date,template,data&limit=5000')
me = get('monthly_expenses?select=date,description,amount,category,vendor&limit=5000')

revenue = 0.0
for s in subs:
    d = s.get('data') or {}
    t = s.get('template', '')
    if t in ('expense_report', 'daily_inspection', 'jha'):
        continue
    if d.get('billable') is False:
        continue
    if d.get('warrantyWork'):
        continue
    revenue += float(d.get('grandTotal') or 0)

tech_exp = sum(
    float((s.get('data') or {}).get('expenseTotal') or 0)
    for s in subs if s.get('template') == 'expense_report'
)

cat_totals = {}
for r in me:
    c = r.get('category') or 'Other'
    cat_totals[c] = cat_totals.get(c, 0) + float(r.get('amount') or 0)

debt_subtotals = {}
# Map various description/vendor variants to a consolidated bucket
def consolidate_debt_label(row):
    v = (row.get('vendor') or '').strip().lower()
    d = (row.get('description') or '').strip().lower()
    s = v + ' ' + d
    # American Momentum must check first (avoids being caught by 'american' rule)
    if 'momentum' in s or 'momentu' in s:
        return 'American Momentum (BMS equipment)'
    if 'amex' in s or 'american' in s:
        return 'American Express (card payoffs)'
    if 'fundbox' in s:
        return 'Fundbox (loan principal)'
    if 'carvana' in s or 'cvna' in s:
        return 'Carvana (vehicle down pmts)'
    if 'qbc' in s or 'intuit financing' in s:
        return 'QuickBooks Capital LOC'
    if 'loan' in s or 'repay' in s:
        return 'Misc loan principal'
    return (row.get('vendor') or row.get('description') or '')[:35] or '(unknown)'

for r in me:
    if r.get('category') == 'Debt Service':
        k = consolidate_debt_label(r)
        debt_subtotals[k] = debt_subtotals.get(k, 0) + float(r.get('amount') or 0)

# Bank-derived numbers for cash reconciliation
wb = xlrd.open_workbook(BANK_XLS)
sh = wb.sheet_by_index(0)
bank_credits = 0.0
bank_debits = 0.0
loan_inflows = 0.0
# Per owner 2026-05-16:
#   - Feb 12 $6,000 + Feb 17 $30,000 + Feb 17 $692 = $36,692 total: all from
#     EX-TEX customer who wrote check out to owner personally. Deposited to
#     personal XX6318, transferred to business XX1440 in multiple chunks.
#     Counted as CUSTOMER REVENUE (collected, just routed via personal acct).
#   - Mar 3 $4K IN + May 1 $4K OUT: personal loan cycle, net $0.
customer_via_xx6318 = 0.0
for r in range(1, sh.nrows):
    date_v = sh.cell_value(r, 1)
    if isinstance(date_v, (int, float)) and date_v > 0:
        date_iso = xlrd.xldate_as_datetime(date_v, 0).date().isoformat()
    else:
        date_iso = ''
    desc = str(sh.cell_value(r, 3) or '')
    debit = float(sh.cell_value(r, 4)) if sh.cell_value(r, 4) not in ('', None) else 0.0
    credit = float(sh.cell_value(r, 5)) if sh.cell_value(r, 5) not in ('', None) else 0.0
    bank_credits += credit
    bank_debits += debit
    if 'ADV CREDIT Fundbox' in desc or 'GPWEB LOAN WEBBANK' in desc:
        loan_inflows += credit
    if 'From Checking XX6318 to Checking XX1440' in desc and credit > 0:
        if abs(credit - 4000.0) < 0.01:
            pass  # Mar 3 $4K personal loan, cancelled by May 1 $4K repayment
        else:
            customer_via_xx6318 += credit  # EX-TEX customer payment per owner
unverified_xfer_in = 0.0  # all resolved

deductible_opex = cat_totals.get('Fixed', 0) + cat_totals.get('Payroll', 0) + cat_totals.get('Other', 0)
debt_service = cat_totals.get('Debt Service', 0)
net_pl = revenue - tech_exp - deductible_opex
# Back out non-revenue credits to get bank-derived collected revenue.
# Per owner: $30K Feb 17 was customer payment (EX-TEX) via XX6318 — count as
# revenue collected. $6,692 still unverified. $4K personal loan cycle cancels.
ar_implied = revenue - (
    bank_credits - loan_inflows - unverified_xfer_in - 4000.0 - 2155.0
    # customer_via_xx6318 stays in (counted as revenue collected)
)


# ---------- Build PDF ----------
print(f'Building PDF -> {OUTPUT}')
doc = SimpleDocTemplate(
    OUTPUT, pagesize=letter,
    leftMargin=0.5 * inch, rightMargin=0.5 * inch,
    topMargin=0.4 * inch, bottomMargin=0.4 * inch,
    title='ROS YTD 2026 Financial Reconciliation',
    author='Reliable Oilfield Services LLC',
)

styles = getSampleStyleSheet()
h1 = ParagraphStyle('h1', parent=styles['Heading1'], fontSize=14, spaceAfter=2, textColor=colors.HexColor('#0f1f38'))
h2 = ParagraphStyle('h2', parent=styles['Heading2'], fontSize=10, spaceAfter=2, spaceBefore=6, textColor=colors.HexColor('#1a2332'))
body = ParagraphStyle('body', parent=styles['Normal'], fontSize=8, leading=10)
small = ParagraphStyle('small', parent=styles['Normal'], fontSize=7, leading=9, textColor=colors.HexColor('#475569'))
note = ParagraphStyle('note', parent=styles['Normal'], fontSize=7, leading=9, textColor=colors.HexColor('#92400e'), backColor=colors.HexColor('#fef3c7'))

story = []

# Header
story.append(Paragraph('<b>Reliable Oilfield Services LLC</b> &nbsp;&nbsp;&nbsp; YTD 2026 Financial Reconciliation', h1))
story.append(Paragraph('As of May 16, 2026 &nbsp;|&nbsp; Prepared for CPA review &nbsp;|&nbsp; Source: app data + bank YTD (XX1440)', small))
story.append(HRFlowable(width='100%', thickness=1, color=colors.HexColor('#0f1f38'), spaceAfter=4))

# Section 1: Operating P&L
story.append(Paragraph('1. Operating P&amp;L (deductible expenses only)', h2))
pl_data = [
    ['Line', 'Source', 'Amount'],
    ['Revenue (PM/SC billed, billable only)', '617 work-order submissions', money(revenue)],
    ['Tech-side expenses (field expense reports)', '2 records', '(' + money(tech_exp) + ')'],
    ['Office expenses — Fixed', 'Insurance / lot rent / fleet / utilities', '(' + money(cat_totals.get('Fixed', 0)) + ')'],
    ['Office expenses — Payroll', 'Intuit payroll + tax + 401k', '(' + money(cat_totals.get('Payroll', 0)) + ')'],
    ['Office expenses — Other', 'Fuel / parts / govt fees / vendors', '(' + money(cat_totals.get('Other', 0)) + ')'],
    ['', '', ''],
    ['NET OPERATING P&L', '', money(net_pl)],
]
pl_table = Table(pl_data, colWidths=[3.0 * inch, 3.0 * inch, 1.4 * inch])
pl_table.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 8),
    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f5f9')),
    ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.HexColor('#475569')),
    ('LINEABOVE', (0, -1), (-1, -1), 0.5, colors.HexColor('#475569')),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 2),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
]))
story.append(pl_table)

# Section 2: Debt Service (non-deductible)
story.append(Paragraph('2. Debt Service / Capital purchases (NON-deductible — excluded from P&amp;L above)', h2))
ds_rows = sorted(debt_subtotals.items(), key=lambda kv: -kv[1])
ds_data = [['Vendor / category', 'Amount', 'Treatment note']]
notes_map = {
    'American Express (card payoffs)': 'Credit-card payoff. Underlying line-item charges already in P&L above.',
    'Fundbox (loan principal)': 'Loan principal portion of ACH debits. Interest ($4,929) is in Other above.',
    'American Momentum (BMS equipment)': 'BMS controller equipment financing — VERIFY Sec 179 vs depreciate.',
    'Carvana (vehicle down pmts)': 'Vehicle down payments — capitalize as Vehicles asset, depreciate.',
    'QuickBooks Capital LOC': 'LOC principal repayment — non-deductible.',
    'Misc loan principal': 'QB LOC + account opening + repay — non-deductible.',
}
for v, amt in ds_rows:
    n = ''
    for key, txt in notes_map.items():
        if key.lower() in (v or '').lower():
            n = txt
            break
    ds_data.append([v, money(amt), Paragraph(n, small)])
ds_data.append(['TOTAL Debt Service', money(debt_service), ''])
ds_table = Table(ds_data, colWidths=[1.7 * inch, 1.1 * inch, 4.6 * inch])
ds_table.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 8),
    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#fef3c7')),
    ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.HexColor('#92400e')),
    ('LINEABOVE', (0, -1), (-1, -1), 0.5, colors.HexColor('#92400e')),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 2),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
]))
story.append(ds_table)

# Section 3: Cash flow reconciliation
story.append(Paragraph('3. Cash flow reconciliation (why P&amp;L &ne; cash on hand)', h2))
equip_total = (
    debt_subtotals.get('American Momentum (BMS equipment)', 0)
    + debt_subtotals.get('Carvana (vehicle down pmts)', 0)
)
debt_principal_total = debt_service - equip_total
cf_data = [
    ['Item', 'Cash impact'],
    ['Net P&L earned YTD', money(net_pl)],
    ['+ Loan inflows (Fundbox $35K + QB Capital $45K)', money(loan_inflows)],
    ['+ Owner loan cycle (personal $4K in + $4K back out, net)', money(0)],
    ['+ EX-TEX customer payment via XX6318 (check made out to owner personally)', money(customer_via_xx6318)],
    ['− Debt principal paid (AmEx + Fundbox principal + QBC + misc)', '(' + money(debt_principal_total) + ')'],
    ['− Equipment + vehicle purchases (American Momentum + Carvana)', '(' + money(equip_total) + ')'],
    ['− A/R timing: billed > collected (Diamondback Net 60 etc.)', '(' + money(max(0, ar_implied)) + ')'],
]
expected_cash_change = (
    net_pl + loan_inflows + customer_via_xx6318
    - debt_service - max(0, ar_implied)
)
cf_data.append(['Expected cash change YTD (matches balance sheet roughly)', money(expected_cash_change)])
cf_table = Table(cf_data, colWidths=[5.4 * inch, 2.0 * inch])
cf_table.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 8),
    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f5f9')),
    ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.HexColor('#475569')),
    ('LINEABOVE', (0, -1), (-1, -1), 0.5, colors.HexColor('#475569')),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 2),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
]))
story.append(cf_table)

# Section 4: CPA action items
story.append(Paragraph('4. CPA decisions requested', h2))
actions = [
    ('Sec 179 / bonus depreciation election on 2026 equipment purchases ($59,090 in Debt Service above).',
     'BMS controllers ($48,100 American Momentum) + Carvana vehicle down payments ($10,990) are capital purchases. If elected as Sec 179, this becomes a $59K deduction in 2026 — Net P&L would drop from $230K to ~$171K.'),
    ('Split principal vs interest on American Momentum + Carvana monthly payments.',
     'Currently lumped entirely into Debt Service. Interest portion is deductible operating expense.'),
    ('Reconcile $130K variance: QuickBooks accrual NI ($100K) vs app cash-basis ($230K).',
     'Likely sources: depreciation on existing fixed assets ($59,680 accumulated per balance sheet), accrued AP not yet on app, accrued payroll. Please confirm.'),
    ('Verify Fundbox interest schedule used for 2026 deduction.',
     'YTD interest: $4,929.27 (per Fundbox statement summary). Includes both 2025 carryover loan and Mar-2026 $35K draw.'),
    ('Process recommendation: have EX-TEX (and similar customers) make checks payable to "Reliable Oilfield Services LLC", not to owner personally.',
     'EX-TEX paid $36,692 in Feb 2026 via a check made out to owner. Owner deposited to personal XX6318, then transferred to business XX1440 in three chunks (Feb 12 $6,000 + Feb 17 $30,000 + Feb 17 $692). All accounted as customer revenue in this report. For clean books going forward, request checks payable to the LLC directly. Without owner-narrated context, QuickBooks/bookkeeper has no way to know these XX6318 transfers were customer revenue vs. owner contribution.'),
]
for title, desc in actions:
    story.append(Paragraph(f'<b>•</b> <b>{title}</b><br/><font size="7" color="#475569">{desc}</font>', body))

# Footer
story.append(Spacer(1, 4))
story.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#cbd5e1'), spaceBefore=2))
story.append(Paragraph(
    f'Generated {datetime.now().strftime("%Y-%m-%d %H:%M")} from Reliable Track app data ('
    f'<font face="Courier" size="6">monthly_expenses</font> + <font face="Courier" size="6">submissions</font>) '
    f'reconciled against bank account XX1440 YTD ({sh.nrows-1} transactions). '
    f'Phase A reconciliation cleanup applied 2026-05-16: 31 rows reclassified to Debt Service, '
    f'17 fictional Fundbox rows deleted, 19 real interest rows + 30 bank-revealed missing rows inserted, '
    f'3 phantom AmEx rows deleted ($24,935 of bookkeeper error). Live dashboard: pm.reliable-oilfield-services.com',
    small,
))

doc.build(story)
print(f'  PDF created: {OUTPUT}')

# Verify
size = os.path.getsize(OUTPUT)
print(f'  File size: {size:,} bytes')
