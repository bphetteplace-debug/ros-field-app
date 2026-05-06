// Static reference data. In cloud mode, customers and parts come from the database
// instead of these arrays — but they remain useful as fallbacks and for development.

export const CUSTOMERS = [
  'Diamondback',
  'High Peak Energy',
  'ExTex',
  'A8 Oilfield Services',
  'Pristine Alliance',
  'KOS',
];

export const TRUCKS = ['0001', '0002', '0003', '0004', '0005', '0006', '0007'];

export const TECHS = ['Matthew Reid', 'Vladimir Rivero', 'Pedro Perez'];

export const WORK_TYPES = [
  'Billable Pm',
  'Warranty Kalos',
  'Warranty ROS',
  'Material Drop Off Billable',
  'Install Billable',
  'Billable Service',
  'Billable Material Pickup',
  'PM Flare/Combustor Flame Arrester',
  'PM Flare',
  'PM BMS',
  'Billable Theif Hatch',
  'Billable PRV',
  'Billable PSV',
];

export const PART_CATEGORIES = [
  'All',
  'BMS',
  'Pilot',
  'Flare/Combustor',
  'Flame Arrestor',
  'Valve / PSV',
  'Thief Hatch',
  'Rentals',
  'Labor',
  'Travel',
  'Kits',
  'Hardware / Misc',
];

export const PM_TEMPLATES = [
  { id: 'flare_combustor', name: 'Flare / Combustor PM' },
  { id: 'bms', name: 'BMS PM' },
  { id: 'thief_hatch', name: 'Thief Hatch PM' },
  { id: 'psv', name: 'PSV Valve PM' },
];
