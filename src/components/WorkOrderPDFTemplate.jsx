// src/components/WorkOrderPDFTemplate.jsx
// ReliableTrack Work Order PDF — completely rebuilt layout
// Clean, professional field-service report format

// Section catalog used by the admin layout editor.
// IDs are stable: do not rename without a migration in PdfLayoutAdmin.
export const PDF_SECTION_DEFS = [
  { id: 'customer_info',  label: 'Job Information' },
  { id: 'field_techs',    label: 'Field Technicians' },
  { id: 'site_sign_gps',  label: 'Site Sign & GPS' },
  { id: 'description',    label: 'Description of Work' },
  { id: 'equipment',      label: 'Equipment Serviced' },
  { id: 'parts',          label: 'Parts Used' },
  { id: 'labor_mileage',  label: 'Labor & Mileage' },
  { id: 'cost_summary',   label: 'Cost Summary' },
  { id: 'completed_work', label: 'Work Photos' },
  { id: 'signatures',     label: 'Authorization & Sign-Off' },
];

export const DEFAULT_PDF_LAYOUT = PDF_SECTION_DEFS.map(s => ({ ...s, enabled: true }));

export const DEFAULT_BRANDING = {
  company_name: 'RELIABLE OILFIELD SERVICES',
  tagline: 'ReliableTrack Field Report',
  primary_color: '#1A1A1A',
  accent_color: '#E35B04',
  logo_url: '',
  pdf_header: '',
  pdf_footer: 'Reliable Oilfield Services · reports@reliable-oilfield-services.com',
};

// Reconciles a saved layout with the current section catalog.
// Drops unknown IDs, appends missing IDs with enabled=true.
export function normalizePdfLayout(saved) {
  const known = new Set(PDF_SECTION_DEFS.map(s => s.id));
  const byId  = new Map(PDF_SECTION_DEFS.map(s => [s.id, s]));
  const out = [];
  const seen = new Set();
  if (Array.isArray(saved)) {
    for (const s of saved) {
      if (!s || !known.has(s.id) || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, label: byId.get(s.id).label, enabled: s.enabled !== false });
    }
  }
  for (const def of PDF_SECTION_DEFS) {
    if (!seen.has(def.id)) out.push({ ...def, enabled: true });
  }
  return out;
}

export function WorkOrderPDFTemplate({ data, layout, branding }) {
  const d = data;
  const parts  = d.parts  || [];
  const photos = d.photos || [];
  const techs  = d.technicians || [];
  const equip  = d.equipment  || [];
  const techCount = d.tech_count || techs.length || 1;
  const plural = techCount !== 1 ? 's' : '';
  const arrestors = d.arrestors || [];
  const flares    = d.flares    || [];
  const heaters   = d.heaters   || [];
  const scEquip   = d.sc_equipment || [];
  const isPM      = d.job_type === 'PM' || (d.job_type && d.job_type.startsWith('pm'));
  const isSC      = ['Service Call','Repair','Other'].includes(d.job_type);
  const showIssue = ['Service Call','Repair','service_call','repair'].includes(d.job_type) || d.job_type?.startsWith('service_') || d.job_type?.startsWith('repair');
  const permits   = d.permits_required || [];

  const b = { ...DEFAULT_BRANDING, ...(branding || {}) };
  const sections = normalizePdfLayout(layout);

  const ORANGE = b.accent_color  || DEFAULT_BRANDING.accent_color;
  const DARK   = b.primary_color || DEFAULT_BRANDING.primary_color;
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

  const tbl  = { width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt', tableLayout: 'fixed' };
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

  // Categorize photos by section
    const custSig  = photos.find(p =>
          /^customer[\s_-]?sig/i.test(p.caption) ||
          p.caption === 'Customer Signature' ||
          p.section === 'customer-sig'
        );
    const techSigs = photos.filter(p =>
          (/\bSignature\b/i.test(p.caption) && p !== custSig) ||
          (p.section && p.section.startsWith('sig-'))
        );
    const siteSig  = photos.find(p =>
          /^site[\s_-]?sign/i.test(p.caption) ||
          p.section === 'site'
        );
                                   const videoPics = photos.filter(p =>
                                         /video/i.test(p.caption) ||
                                         (p.section && p.section.includes('video'))
                                       );
    // Work photos: everything that isn't a signature, site sign, video, or part photo
    const workPics = photos.filter(p =>
          p !== custSig &&
          p !== siteSig &&
          !techSigs.includes(p) &&
          !videoPics.includes(p) &&
          !/^part[-_]/i.test(p.section || '') &&
          !/^(arrestor|flare|heater)[-_]/i.test(p.section || '')
        );
  const laborLine   = d.labor_hours > 0 ? `${d.labor_hours} hrs × $${d.labor_rate}/hr × ${techCount} tech${plural}` : '—';
  const mileageLine = d.mileage_miles > 0 ? `${d.mileage_miles} mi × $${d.mileage_rate}/mi` : '—';

  const jobTypeFull = d.job_type === 'PM' ? 'Preventive Maintenance'
    : d.job_type === 'SC' ? 'Service Call'
    : (d.job_type || '');

  // ── Section renderers ────────────────────────────────────────────────────
  // Each renderer returns the JSX for a single configurable section, or null
  // if there's nothing to render. The render loop below skips null returns.

  const renderCustomerInfo = () => (
    <>
      <div style={sectionBar}>Job Information</div>
      <div style={infoGrid}>
        {F('Customer', d.customer)}
        {F('Location / Site', d.location)}
        {F('Customer WO #', d.customer_wo_number, true)}
        {F('Type of Work', d.type_of_work)}
        {F('Work Area', d.work_area)}
        {F('Site Contact', d.contact, true)}
        {F('Start Time', d.start_time)}
        {F('Departure Time', d.departure_time)}
        {F('Truck #', d.truck_number, true)}
        {F('GL Code', d.gl_code)}
        {F('Asset Tag', d.asset_tag)}
        {F('Last Service', d.last_service_date, true)}
      </div>
    </>
  );

  const renderFieldTechs = () => (
    <>
      <div style={sectionBar}>Field Technicians ({techCount})</div>
      <div style={badgesWrap}>
        {techs.length > 0
          ? techs.map((t, i) => <span key={i} style={techBadge}>{t}</span>)
          : <span style={emptyNote}>No technicians listed</span>}
      </div>
    </>
  );

  const renderSiteSignGps = () => {
    const hasGps = d.gps_lat != null && d.gps_lng != null;
    if (!siteSig && !hasGps) return null;
    return (
      <>
        <div style={sectionBar}>Site Sign &amp; GPS</div>
        <div style={{ border: `1px solid ${BORDER}`, borderTop: 'none', background: LIGHT, padding: '10px 14px', display: 'grid', gridTemplateColumns: siteSig && hasGps ? '1fr 1fr' : '1fr', gap: 12, alignItems: 'center' }}>
          {siteSig && (
            <div>
              <img src={siteSig.url} alt={siteSig.caption || 'Site sign'} style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 3, border: `1px solid ${BORDER}` }} crossOrigin="anonymous" />
              <div style={photoCap}>{siteSig.caption || 'Site Sign'}</div>
            </div>
          )}
          {hasGps && (
            <div style={{ fontSize: '8.5pt', lineHeight: 1.6 }}>
              <div style={infoLabel}>GPS Coordinates</div>
              <div style={{ fontWeight: 'bold', color: DARK }}>{Number(d.gps_lat).toFixed(6)}, {Number(d.gps_lng).toFixed(6)}</div>
              {d.gps_accuracy != null && (
                <div style={{ color: MID, marginTop: 2 }}>Accuracy: Â±{Math.round(d.gps_accuracy)} m</div>
              )}
            </div>
          )}
        </div>
      </>
    );
  };

  const renderDescription = () => (
    <>
      <div style={sectionBar}>Description of Work</div>
      <div style={descBox}>
        {d.description_of_work || <span style={emptyNote}>No description provided.</span>}
      </div>
      {showIssue && d.reported_issue && (
        <>
          <div style={sectionBar}>Reported Issue</div>
          <div style={descBox}>{d.reported_issue}</div>
        </>
      )}
      {showIssue && d.root_cause && (
        <>
          <div style={sectionBar}>Root Cause</div>
          <div style={descBox}>{d.root_cause}</div>
        </>
      )}
      {permits.length > 0 && (
        <>
          <div style={sectionBar}>Permits Required</div>
          <div style={{...badgesWrap, borderTop:'none'}}>
            {permits.map((p,i)=><span key={i} style={equipTag}>{p}</span>)}
          </div>
        </>
      )}
    </>
  );

  const renderEquipment = () => {
    if (equip.length === 0 && (!isSC || scEquip.length === 0) && (!isPM || (arrestors.length === 0 && flares.length === 0 && heaters.length === 0))) return null;
    return (
      <>
        {equip.length > 0 && (
          <>
            <div style={sectionBar}>Equipment Serviced</div>
            <div style={{ ...badgesWrap, borderTop: 'none' }}>
              {equip.map((eq, i) => <span key={i} style={equipTag}>{eq}</span>)}
            </div>
          </>
        )}
        {isSC && scEquip.length > 0 && (
          <>
            <div style={sectionBar}>SC Equipment ({scEquip.length})</div>
            <div style={{...badgesWrap, borderTop:'none'}}>
              {scEquip.map((eq,i)=><span key={i} style={equipTag}>{eq.type||String(eq)}</span>)}
            </div>
          </>
        )}
        {isPM && arrestors.length > 0 && (
          <>
            <div style={sectionBar}>Flame Arrestors ({arrestors.length})</div>
            <div style={{...badgesWrap,borderTop:'none',flexDirection:'column',alignItems:'flex-start'}}>
              {arrestors.map((a,i)=>(
                <div key={i} style={{fontSize:'8.5pt',marginBottom:2}}>
                  <b>#{i+1} {a.arrestorId||'Unlabeled'}</b> &mdash; {a.condition||''}{a.filterChanged?' · Filter Changed':''}{a.notes?' · '+a.notes:''}
                </div>
              ))}
            </div>
          </>
        )}
        {isPM && flares.length > 0 && (
          <>
            <div style={sectionBar}>Flares / Combustors ({flares.length})</div>
            <div style={{...badgesWrap,borderTop:'none',flexDirection:'column',alignItems:'flex-start'}}>
              {flares.map((f,i)=>(
                <div key={i} style={{fontSize:'8.5pt',marginBottom:2}}>
                  <b>#{i+1} {f.flareId||'Unlabeled'}</b> &mdash; {f.condition||''}, Pilot: {f.pilotLit?'Lit':'Not Lit'}{f.last_ignition?' · Last Ignition: '+f.last_ignition:''}{f.notes?' · '+f.notes:''}
                </div>
              ))}
            </div>
          </>
        )}
        {isPM && heaters.length > 0 && (
          <>
            <div style={sectionBar}>Heater Treaters ({heaters.length})</div>
            <div style={{...badgesWrap,borderTop:'none',flexDirection:'column',alignItems:'flex-start'}}>
              {heaters.map((h,i)=>(
                <div key={i} style={{fontSize:'8.5pt',marginBottom:2}}>
                  <b>#{i+1} {h.heaterId||'Unlabeled'}</b> &mdash; {h.condition||''}, Firetubes: {h.firetubeCnt||(h.firetubes&&h.firetubes.length)||0}{h.notes?' · '+h.notes:''}
                </div>
              ))}
            </div>
          </>
        )}
      </>
    );
  };

  const renderParts = () => (
    <>
      <div style={sectionBar}>Parts Used ({parts.length})</div>
      {parts.length > 0 ? (
        <table style={tbl}>
            <colgroup><col style={{width:'42%'}}/><col style={{width:'20%'}}/><col style={{width:'8%'}}/><col style={{width:'15%'}}/><col style={{width:'15%'}}/></colgroup>
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
                  <td style={alt ? { ...tdA, maxWidth: '180px', wordBreak: 'break-word' } : { ...td, maxWidth: '180px', wordBreak: 'break-word' }}>
                    {p.description}
                    {p.photos && p.photos.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                        {p.photos.map((ph, pi) => (
                          <img
                            key={pi}
                            src={ph.url}
                            alt={ph.caption || 'Part photo'}
                            style={{ width: 55, height: 55, objectFit: 'cover', borderRadius: 2, border: '1px solid ' + BORDER }}
                            crossOrigin="anonymous"
                          />
                        ))}
                      </div>
                    )}
                  </td>
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
    </>
  );

  const renderLaborMileage = () => (
    <>
      <div style={sectionBar}>Labor &amp; Mileage</div>
      <div style={infoGrid}>
        {F('Labor Hours', d.labor_hours > 0 ? d.labor_hours + ' hrs' : '—')}
        {F('Labor Rate', d.labor_rate ? '$' + d.labor_rate + '/hr' : '—')}
        {F('Labor Total', d.cost_labor, true)}
        {F('Miles Driven', d.mileage_miles > 0 ? d.mileage_miles + ' mi' : '—')}
        {F('Mileage Rate', d.mileage_rate ? '$' + d.mileage_rate + '/mi' : '—')}
        {F('Mileage Total', d.cost_mileage, true)}
      </div>
    </>
  );

  const renderCostSummary = () => (
    <>
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
    </>
  );

  const renderWorkPhotos = () => {
    if (workPics.length === 0) return null;
    return (
      <>
        <div style={sectionBar}>Work Photos ({workPics.length})</div>
        <div style={photosGrid}>
          {workPics.map((ph, i) => (
            <div key={i}>
              <img src={ph.url} alt={ph.caption || 'Photo'} style={photoImg} crossOrigin="anonymous" />
              {ph.caption && <div style={photoCap}>{ph.caption}</div>}
            </div>
          ))}
        </div>
      </>
    );
  };

  const renderSignatures = () => (
    <>
      <div style={sectionBar}>Authorization &amp; Sign-Off</div>
      <div style={sigGrid}>
        <div style={sigCell}>
          <div style={sigLabel}>Customer Signature</div>
          {custSig
            ? <img src={custSig.url} alt="Customer signature" style={sigImg} crossOrigin="anonymous" />
            : <div style={sigLine} />}
          <div style={{ ...sigLabel, marginTop: 6 }}>Customer / Authorized Representative</div>
        </div>
        <div style={sigCellLast}>
          <div style={sigLabel}>Technician Certification</div>
          <div style={{ fontSize: '8pt', color: MID, marginTop: 4, lineHeight: 1.5 }}>
            I certify the work described above was performed professionally and all information is accurate.
          </div>
          {techSigs.length > 0
            ? techSigs.map((ts, i) => (
                <div key={i} style={{ marginTop: 8 }}>
                  <img src={ts.url} alt={ts.caption} style={sigImg} crossOrigin="anonymous" />
                  <div style={{ ...sigLabel, marginTop: 4 }}>{ts.caption}</div>
                </div>
              ))
            : <div style={{ ...sigLabel, marginTop: 10 }}>Performed by: <strong>{techs.join(', ') || '—'}</strong></div>
          }
          <div style={{ ...sigLabel, marginTop: 4 }}>Date: <strong>{d.date_long}</strong></div>
        </div>
      </div>
    </>
  );

  const RENDERERS = {
    customer_info:  renderCustomerInfo,
    field_techs:    renderFieldTechs,
    site_sign_gps:  renderSiteSignGps,
    description:    renderDescription,
    equipment:      renderEquipment,
    parts:          renderParts,
    labor_mileage:  renderLaborMileage,
    cost_summary:   renderCostSummary,
    completed_work: renderWorkPhotos,
    signatures:     renderSignatures,
  };

  return (
    <div style={page}>

      {/* HEADER */}
      <div style={header}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {b.logo_url ? (
            <img src={b.logo_url} alt="Logo" style={{ height: 44, maxWidth: 120, objectFit: 'contain', background: 'transparent' }} crossOrigin="anonymous" />
          ) : null}
          <div>
            <div style={coName}>{b.company_name || 'COMPANY NAME'}</div>
            <div style={coSub}>{b.tagline || ''}</div>
            {b.pdf_header && <div style={{ fontSize: '7.5pt', color: '#CCCCCC', marginTop: 3 }}>{b.pdf_header}</div>}
            {jobTypeFull && <div style={jobTag}>{jobTypeFull}</div>}
            {d.warranty_work && (
              <div style={{ color: '#FF6B00', fontWeight: 'bold', fontSize: '8pt', marginTop: 4 }}>⚠ WARRANTY WORK</div>
            )}
          </div>
        </div>
        <div style={woBlock}>
          <div style={woLabel}>Work Order</div>
          <div style={woNum}>#{d.customer_wo_number}</div>
          <div style={dateStr}>{d.date_long}</div>
        </div>
      </div>

      <div style={body}>
        {sections.filter(s => s.enabled && RENDERERS[s.id]).map(s => {
          const node = RENDERERS[s.id]();
          if (node == null) return null;
          return <div key={s.id}>{node}</div>;
        })}
      </div>

      {/* FOOTER */}
      <div style={footer}>
        <span>{b.pdf_footer || DEFAULT_BRANDING.pdf_footer}</span>
        <span>Generated {d.generated_at}</span>
        <span>WO #{d.customer_wo_number}</span>
      </div>

    </div>
  );
}
