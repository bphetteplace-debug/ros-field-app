import { describe, it, expect } from 'vitest'
import {
  parseReceiptText,
  detectCategory,
  extractAmount,
  extractVendor,
  extractDate,
} from '../receiptParser'

describe('detectCategory', () => {
  it('recognises fuel receipts', () => {
    expect(detectCategory('SHELL 1234 Main St Diesel 12.5 GAL Total 55.55')).toBe('Fuel')
    expect(detectCategory('Loves Travel Stop 18 GAL Unleaded')).toBe('Fuel')
    expect(detectCategory('LOVE\'S TRAVEL STOP fuel total 78.00')).toBe('Fuel')
  })
  it('recognises meals', () => {
    expect(detectCategory('McDonald\'s #1234 Drive Thru Total 12.45')).toBe('Meals')
    expect(detectCategory('TACO BELL #555 Combo Meal 9.99')).toBe('Meals')
  })
  it('recognises lodging', () => {
    expect(detectCategory('HAMPTON INN Midland Room 215 Total 142.30')).toBe('Lodging')
  })
  it('recognises tools/supplies', () => {
    expect(detectCategory('HOME DEPOT 1/2-13 hex nuts Total 18.40')).toBe('Tools / Supplies')
    expect(detectCategory('Tractor Supply Co. fasteners')).toBe('Tools / Supplies')
  })
  it('returns null when no category matches', () => {
    expect(detectCategory('Just some random text with no keywords')).toBe(null)
  })
  it('handles empty/garbage input', () => {
    expect(detectCategory('')).toBe(null)
    expect(detectCategory(null)).toBe(null)
    expect(detectCategory(undefined)).toBe(null)
  })
})

describe('extractAmount', () => {
  it('prefers labelled totals over largest amount', () => {
    expect(extractAmount('Subtotal 50.00 Tax 4.25 Total 54.25')).toBe(54.25)
    expect(extractAmount('Item 1 100.00 Item 2 25.00 Total Due: $40.00')).toBe(40.0)
  })
  it('matches "Grand Total" / "Amount Due" / "Balance Due"', () => {
    expect(extractAmount('GRAND TOTAL 99.99')).toBe(99.99)
    expect(extractAmount('AMOUNT DUE 12.34')).toBe(12.34)
    expect(extractAmount('Balance Due $7.50')).toBe(7.5)
  })
  it('falls back to largest dollar amount when no label found', () => {
    expect(extractAmount('Some text 5.00 then 25.99 maybe 3.49')).toBe(25.99)
  })
  it('caps at 100000 to ignore OCR garbage', () => {
    expect(extractAmount('Total 999999.99')).toBe(null)
  })
  it('returns null when no dollar amounts present', () => {
    expect(extractAmount('No prices here')).toBe(null)
    expect(extractAmount('')).toBe(null)
    expect(extractAmount(null)).toBe(null)
  })
})

describe('extractVendor', () => {
  it('takes the first short non-noise fragment', () => {
    expect(extractVendor('SHELL 1234 Main St TX 79401')).toBe('SHELL')
    expect(extractVendor('HOME DEPOT 555 Andrews Hwy')).toBe('HOME DEPOT')
  })
  it('strips header noise like WELCOME TO / RECEIPT', () => {
    expect(extractVendor('WELCOME TO LOVE\'S TRAVEL STOP 89 Diesel')).toBe("LOVE'S TRAVEL STOP")
    expect(extractVendor('Receipt Store #1234 ACME GAS 555 Main')).toBe('ACME GAS')
  })
  it('returns null on garbage', () => {
    expect(extractVendor('')).toBe(null)
    expect(extractVendor(null)).toBe(null)
    expect(extractVendor('12345 6789')).toBe(null)
  })
})

describe('extractDate', () => {
  it('parses MM/DD/YYYY', () => {
    expect(extractDate('Date 05/16/2026 Time 14:32')).toBe('2026-05-16')
  })
  it('parses MM/DD/YY by adding 2000', () => {
    expect(extractDate('05/16/26 receipt')).toBe('2026-05-16')
  })
  it('parses YYYY-MM-DD directly', () => {
    expect(extractDate('Transaction 2026-05-16 confirmed')).toBe('2026-05-16')
  })
  it('rejects impossible dates', () => {
    expect(extractDate('13/45/2026')).toBe(null)
  })
  it('returns null when no date found', () => {
    expect(extractDate('No dates here')).toBe(null)
    expect(extractDate('')).toBe(null)
  })
})

describe('parseReceiptText (integration)', () => {
  it('parses a realistic fuel receipt', () => {
    const text = 'SHELL 4847 Andrews Hwy Midland TX 79707 05/16/2026 14:32 Pump 4 Diesel 12.345 gal @ 4.499 Subtotal 55.55 Tax 0.00 Total 55.55 Card xxxx1234 Auth 023456 Thank you'
    const out = parseReceiptText(text)
    expect(out.vendor).toBe('SHELL')
    expect(out.amount).toBe(55.55)
    expect(out.category).toBe('Fuel')
    expect(out.date).toBe('2026-05-16')
  })
  it('parses a hotel receipt', () => {
    const text = 'HAMPTON INN Midland 4101 W Wall St 05/15/2026 Room 215 1 night @ 142.30 Subtotal 142.30 Tax 18.40 Total Due $160.70 Confirmation #ABC123'
    const out = parseReceiptText(text)
    expect(out.vendor).toBe('HAMPTON INN Midland')
    expect(out.amount).toBe(160.7)
    expect(out.category).toBe('Lodging')
    expect(out.date).toBe('2026-05-15')
  })
  it('handles empty input', () => {
    expect(parseReceiptText('')).toEqual({})
    expect(parseReceiptText(null)).toEqual({})
  })
})
