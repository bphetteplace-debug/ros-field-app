// src/components/WorkOrderPDFTemplate.jsx
// ReliableTrack Work Order PDF — completely rebuilt layout
// Clean, professional field-service report format

export function WorkOrderPDFTemplate({ data }) {
  const d = data;
  const parts  = d.parts  || [];
  const photos = d.photos || [];
  const techs  = d.technicians || [];
  const equip  = d.equipment  || [];
  const techCount = d.tech_count || techs.length || 1;
  const plural = techCount !== 1 ? 's' : '';

  const ORANGE = '#E35B04';
  const DARK   = '#1A1A1A';
  const MID    = '#444444';
  const LIGHT  = '#F5F5F5';
  const BORDER = '#DDDDDD';
  const WHITE  = '#FFFFFF';

  const page = {
    fontFamily: "'Arial','Helvetica Neue',Helvetica,sans-serif",
    fontSize: '9pt',
    color: DARK,
    background: WHITE,
    width: '8.5in',
    margin: 0,
    padding: 0,
  };

  const header = {
    background: DARK,
    color: WHITE,
    padding: '14px 24px 10px 24px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderBottom: `4px solid ${ORANGE}`,
  };
  const coName  = { fontSize: '15pt', fontWeight: 'bold', letterSpacing: '0.5px', color: WHITE };
  const coSub   = { fontSize: '8pt', color: '#AAAAAA', marginTop: 2 };
  const woBlock = { textAlign: 'right' };
  const woLabel = { fontSize: '7pt', color: '#AAAAAA', textTransform: 'uppercase', letterSpacing: '1px' };
  const woNum   = { fontSize: '20pt', fontWeight: 'bold', color: ORANGE, lineHeight: 1 };
  const dateStr = { fontSize: '8pt', color: '#AAAAAA', marginTop: 3 };
  const jobTag  = {
    display: 'inline-block',
    background: ORANGE,
    color: WHITE,
    fontSize: '7pt',
    fontWeight: 'bold',
    padding: '2px 8px',
    borderRadius: 3,
    marginTop: 4,
    textTransform: 'uppercase',
  };

  const sectionBar = {
    background: ORANGE,
    color: WHITE,
    fontWeight: 'bold',
    fontSize: '8pt',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    padding: '5px 14px',
    marginTop: 10,
  };

  const infoGrid = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    background: WHITE,
    border: `1px solid ${BORDER}`,
    borderTop: 'none',
  };
  const infoCell     = { padding: '7px 14px', borderRight: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` };
  const infoCellLast = { padding: '7px 14px', borderBottom: `1px solid ${BORDER}` };
  const infoLabel    = { fontSize: '7pt', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 };
  const infoVal      = { fontSize: '9pt', fontWeight: 'bold', color: DARK };

  const body = { padding: '0 24px 24px 24px' };

  const descBox = {
    border: `1px solid ${BORDER}`,
    borderTop: 'none',
    padding: '10px 14px',
    minHeight: '54px',
    lineHeight: '1.5',
    color: MID,
    fontSize: '9pt',
    background: LIGHT,
  };

  const tbl  = { width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' };
  const th   = { background: DARK, color: WHITE, padding: '5px 10px', textAlign: 'left', fontSize: '7.5pt', fontWeight: 'bold', textTransform: 'uppercase', border: `1px solid ${DARK}` };
  const thR  = { ...th, textAlign: 'right' };
  const td   = { padding: '6px 10px', border: `1px solid ${BORDER}`, verticalAlign: 'top' };
  const tdR  = { ...td, textAlign: 'right' };
  const tdA  = { ...td, background: LIGHT };
  const tdAR = { ...tdA, textAlign: 'right' };

  const costBlock = { border: `1px solid ${BORDER}`, borderTop: 'none', overflow: 'hidden' };
  const costRow   = { display: 'flex', justifyContent: 'space-between', padding: '7px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: '9pt' };
  const costTotal = { ...costRow, background: DARK, color: WHITE, fontWeight: 'bold', fontSize: '11pt', borderBottom: 'none' };

  const badgesWrap = {
    display: 'flex', flexWrap: 'wrap', gap: '6px',
    padding: '8px 14px', border: `1px solid ${BORDER}`, borderTop: 'none',
    background: LIGHT, minHeight: '36px', alignItems: 'center',
  };
  const techBadge = { background: DARK, color: WHITE, padding: '3px 10px', borderRadius: 12, fontSize: '8pt', fontWeight: 'bold' };
  const equipTag  = {
    display: 'inline-block', background: '#E8F0FE', color: '#1A3A8F',
    border: '1px solid #B0C4DE', padding: '3px 10px', borderRadius: 3,
    fontSize: '8.5pt', marginRight: 5, marginBottom: 4,
  };
  const emptyNote = { color: '#AAA', fontStyle: 'italic', fontSize: '8.5pt' };

  const photosGrid = {
    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px',
    padding: '10px 14px', border: `1px solid ${BORDER}`, borderTop: 'none', background: LIGHT,
  };
  const photoImg = { width: '100%', height: '140px', objectFit: 'cover', display: 'block', borderRadius: 3, border: `1px solid ${BORDER}` };
  const photoCap = { fontSize: '7pt', color: '#888', marginTop: 3, textAlign: 'center' };

  const sigGrid     = { display: 'grid', gridTemplateColumns: '1fr 1fr', border: `1px solid ${BORDER}`, borderTop: 'none' };
  const sigCell     = { padding: '10px 14px', borderRight: `1px solid ${BORDER}` };
  const sigCellLast = { padding: '10px 14px' };
  const sigLabel    = { fontSize: '7pt', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 };
  const sigLine     = { borderTop: `1px solid ${BORDER}`, marginTop: '40px', width: '160px' };
  const sigImg      = { maxHeight: '52px', maxWidth: '180px', objectFit: 'contain' };

  const footer = {
    borderTop: `3px solid ${ORANGE}`,
    marginTop: 16, padding: '8px 24px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: DARK, color: '#888', fontSize: '7.5pt',
  };

  const F = (label, val, last) => (
    <div style={last ? infoCellLast : infoCell}>
      <div style={infoLabel}>{label}</div>
      <div style={infoVal}>{val || <span style={{ color: '#CCC' }}>—</span>}</div>
    </div>
  );

  const custSig  = photos.find(p => /cust|sig/i.test(p.caption || ''));
  const workPics = photos.filter(p => !custSig || p.url !== custSig.url);

  const laborLine   = d.labor_hours > 0 ? `${d.labor_hours} hrs × $${d.labor_rate}/hr × ${techCount} tech${plural}` : '—';
  const mileageLine = d.mileage_miles > 0 ? `${d.mileage_miles} mi × $${d.mileage_rate}/mi` : '—';

  const jobTypeFull = d.job_type === 'PM' ? 'Preventive Maintenance'
    : d.job_type === 'SC' ? 'Service Call'
    : (d.job_type || '');

  return (
    <div style={page}>

      {/* HEADER */}
      <div style={header}>
        <div>
          <div style={coName}>RELIABLE OILFIELD SERVICES</div>
          <div style={coSub}>ReliableTrack Field Report</div>
          {jobTypeFull && <div style={jobTag}>{jobTypeFull}</div>}
        </div>
        <div style={woBlock}>
          <div style={woLabel}>Work Order</div>
          <div style={woNum}>#{d.customer_wo_number}</div>
          <div style={dateStr}>{d.date_long}</div>
        </div>
      </div>

      <div style={body}>

        {/* JOB INFORMATION */}
        <div style={sectionBar}>Job Information</div>
        <div style={infoGrid}>
          {F('Customer', d.customer)}
          {F('Location / Site', d.location)}
          {F('Type of Work', d.type_of_work)}
          {F('Work Area', d.work_area)}
          {F('Site Contact', d.contact, true)}
          {F('Start Time', d.start_time)}
          {F('Departure Time', d.departure_time)}
          {F('Truck #', d.truck_number, true)}
        </div>

        {/* FIELD TECHNICIANS */}
        <div style={sectionBar}>Field Technicians ({techCount})</div>
        <div style={badgesWrap}>
          {techs.length > 0
            ? techs.map((t, i) => <span key={i} style={techBadge}>{t}</span>)
            : <span style={emptyNote}>No technicians listed</span>}
        </div>

        {/* DESCRIPTION OF WORK */}
        <div style={sectionBar}>Description of Work</div>
        <div style={descBox}>
          {d.description_of_work || <span style={emptyNote}>No description provided.</span>}
        </div>

        {/* EQUIPMENT SERVICED */}
        {equip.length > 0 && (
          <>
            <div style={sectionBar}>Equipment Serviced</div>
            <div style={{ ...badgesWrap, borderTop: 'none' }}>
              {equip.map((eq, i) => <span key={i} style={equipTag}>{eq}</span>)}
            </div>
          </>
        )}

        {/* PARTS USED */}
        <div style={sectionBar}>Parts Used ({parts.length})</div>
        {parts.length > 0 ? (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>SKU / Part #</th>
                <th style={th}>Description</th>
                <th style={thR}>Qty</th>
                <th style={thR}>Unit Price</th>
                <th style={thR}>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p, i) => {
                const alt = i % 2 === 1;
                return (
                  <tr key={i}>
                    <td style={alt ? tdA : td}>{p.sku || '—'}</td>
                    <td style={alt ? tdA : td}>{p.description}</td>
                    <td style={alt ? tdAR : tdR}>{p.qty}</td>
                    <td style={alt ? tdAR : tdR}>{p.unit_price}</td>
                    <td style={alt ? { ...tdAR, fontWeight: 'bold' } : { ...tdR, fontWeight: 'bold' }}>{p.line_total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ ...descBox, minHeight: '30px' }}>
            <span style={emptyNote}>No parts used on this job.</span>
          </div>
        )}

        {/* LABOR & MILEAGE */}
        <div style={sectionBar}>Labor &amp; Mileage</div>
        <div style={infoGrid}>
          {F('Labor Hours', d.labor_hours > 0 ? d.labor_hours + ' hrs' : '—')}
          {F('Labor Rate', d.labor_rate ? '$' + d.labor_rate + '/hr' : '—')}
          {F('Labor Total', d.cost_labor, true)}
          {F('Miles Driven', d.mileage_miles > 0 ? d.mileage_miles + ' mi' : '—')}
          {F('Mileage Rate', d.mileage_rate ? '$' + d.mileage_rate + '/mi' : '—')}
          {F('Mileage Total', d.cost_mileage, true)}
        </div>

        {/* COST SUMMARY */}
        <div style={sectionBar}>Cost Summary</div>
        <div style={costBlock}>
          <div style={costRow}>
            <span style={{ color: MID }}>Parts &amp; Materials</span>
            <span style={{ fontWeight: 'bold' }}>{d.cost_parts}</span>
          </div>
          <div style={costRow}>
            <span style={{ color: MID }}>Labor ({laborLine})</span>
            <span style={{ fontWeight: 'bold' }}>{d.cost_labor}</span>
          </div>
          <div style={costRow}>
            <span style={{ color: MID }}>Mileage ({mileageLine})</span>
            <span style={{ fontWeight: 'bold' }}>{d.cost_mileage}</span>
          </div>
          <div style={costTotal}>
            <span>TOTAL DUE</span>
            <span style={{ color: ORANGE }}>{d.cost_total}</span>
          </div>
        </div>

        {/* WORK PHOTOS */}
        {workPics.length > 0 && (
          <>
            <div style={sectionBar}>Work Photos ({workPics.length})</div>
            <div style={photosGrid}>
              {workPics.map((ph, i) => (
                <div key={i}>
                  <img src={ph.url} alt={ph.caption || 'Photo'} style={photoImg} />
                  {ph.caption && <div style={photoCap}>{ph.caption}</div>}
                </div>
              ))}
            </div>
          </>
        )}

        {/* SIGN-OFF */}
        <div style={sectionBar}>Authorization &amp; Sign-Off</div>
        <div style={sigGrid}>
          <div style={sigCell}>
            <div style={sigLabel}>Customer Signature</div>
            {custSig
              ? <img src={custSig.url} alt="Customer signature" style={sigImg} />
              : <div style={sigLine} />}
            <div style={{ ...sigLabel, marginTop: 6 }}>Customer / Authorized Representative</div>
          </div>
          <div style={sigCellLast}>
            <div style={sigLabel}>Technician Certification</div>
            <div style={{ fontSize: '8pt', color: MID, marginTop: 4, lineHeight: 1.5 }}>
              I certify the work described above was performed professionally and all information is accurate.
            </div>
            <div style={{ ...sigLabel, marginTop: 10 }}>Performed by: <strong>{techs.join(', ') || '—'}</strong></div>
            <div style={{ ...sigLabel, marginTop: 4 }}>Date: <strong>{d.date_long}</strong></div>
          </div>
        </div>

      </div>

      {/* FOOTER */}
      <div style={footer}>
        <span>Reliable Oilfield Services · reports@reliable-oilfield-services.com</span>
        <span>Generated {d.generated_at}</span>
        <span>WO #{d.customer_wo_number}</span>
      </div>

    </div>
  );
}
