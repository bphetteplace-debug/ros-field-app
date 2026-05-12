// src/components/WorkOrderPDFTemplate.jsx
// Self-contained React component for Work Order PDF rendering
// Used by DownloadPDFButton (client) and api/send-report.js (server via renderToStaticMarkup)

export function WorkOrderPDFTemplate({ data }) {
  const d = data;
  const techPlural = (d.tech_count || 1) !== 1 ? 's' : '';

  const styles = {
    page: {
      fontFamily: "'Arial', 'Helvetica Neue', Helvetica, sans-serif",
      fontSize: '10pt',
      color: '#1a1a1a',
      background: '#fff',
      margin: 0,
      padding: 0,
      width: '8.5in',
    },
    header: {
      background: '#1a2744',
      color: '#fff',
      padding: '18px 28px 14px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    headerLeft: {
      display: 'flex',
      flexDirection: 'column',
    },
    headerCompany: {
      fontSize: '13pt',
      fontWeight: 'bold',
      letterSpacing: '0.04em',
      marginBottom: '4px',
    },
    headerSub: {
      fontSize: '9pt',
      opacity: 0.85,
    },
    headerRight: {
      textAlign: 'right',
    },
    headerWO: {
      fontSize: '18pt',
      fontWeight: 'bold',
      lineHeight: 1.1,
    },
    headerCustomer: {
      fontSize: '11pt',
      marginTop: '3px',
    },
    headerLocation: {
      fontSize: '10pt',
      opacity: 0.85,
      marginTop: '2px',
    },
    headerDate: {
      fontSize: '9pt',
      opacity: 0.75,
      marginTop: '2px',
    },
    body: {
      padding: '18px 28px',
    },
    card: {
      border: '1px solid #dde3ed',
      borderRadius: '6px',
      marginBottom: '14px',
      pageBreakInside: 'avoid',
      overflow: 'hidden',
    },
    cardHeader: {
      background: '#f0f3f9',
      borderBottom: '1px solid #dde3ed',
      padding: '7px 14px',
      fontWeight: 'bold',
      fontSize: '9.5pt',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: '#2c3e6b',
    },
    cardBody: {
      padding: '12px 14px',
    },
    grid2: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '6px 20px',
    },
    grid3: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '6px 20px',
    },
    field: {
      marginBottom: '4px',
    },
    fieldLabel: {
      fontSize: '8pt',
      color: '#6b7a99',
      fontWeight: 'bold',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      marginBottom: '1px',
    },
    fieldValue: {
      fontSize: '10pt',
      color: '#1a1a1a',
      wordBreak: 'break-word',
    },
    techBadge: {
      display: 'inline-block',
      background: '#e8f0fe',
      color: '#1a2744',
      borderRadius: '12px',
      padding: '2px 10px',
      fontSize: '9pt',
      marginRight: '6px',
      marginBottom: '4px',
      fontWeight: '600',
    },
    equipBadge: {
      display: 'inline-block',
      background: '#fff3e0',
      color: '#7a3a00',
      borderRadius: '4px',
      padding: '2px 9px',
      fontSize: '9pt',
      marginRight: '6px',
      marginBottom: '4px',
      border: '1px solid #ffe0b2',
    },
    descBox: {
      background: '#fafbfd',
      border: '1px solid #e4e9f2',
      borderRadius: '4px',
      padding: '10px 12px',
      fontSize: '10pt',
      whiteSpace: 'pre-wrap',
      lineHeight: 1.55,
      minHeight: '48px',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '9.5pt',
    },
    th: {
      background: '#f0f3f9',
      borderBottom: '2px solid #c6d0e6',
      padding: '6px 10px',
      textAlign: 'left',
      fontWeight: 'bold',
      color: '#2c3e6b',
      fontSize: '8.5pt',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    },
    thRight: {
      background: '#f0f3f9',
      borderBottom: '2px solid #c6d0e6',
      padding: '6px 10px',
      textAlign: 'right',
      fontWeight: 'bold',
      color: '#2c3e6b',
      fontSize: '8.5pt',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    },
    td: {
      padding: '6px 10px',
      borderBottom: '1px solid #edf0f7',
      verticalAlign: 'top',
    },
    tdRight: {
      padding: '6px 10px',
      borderBottom: '1px solid #edf0f7',
      verticalAlign: 'top',
      textAlign: 'right',
    },
    tdBold: {
      padding: '6px 10px',
      borderBottom: '1px solid #edf0f7',
      verticalAlign: 'top',
      fontWeight: '600',
    },
    costRow: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '5px 0',
      borderBottom: '1px solid #edf0f7',
      fontSize: '10pt',
    },
    costRowTotal: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '7px 0',
      borderTop: '2px solid #1a2744',
      fontWeight: 'bold',
      fontSize: '11pt',
      marginTop: '4px',
    },
    costLabel: {
      color: '#555',
    },
    costValue: {
      fontWeight: '600',
      color: '#1a1a1a',
    },
    photoGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '10px',
    },
    photoCell: {
      border: '1px solid #dde3ed',
      borderRadius: '4px',
      overflow: 'hidden',
    },
    photoImg: {
      width: '100%',
      aspectRatio: '4/3',
      objectFit: 'cover',
      display: 'block',
    },
    photoCaption: {
      padding: '4px 6px',
      fontSize: '8pt',
      color: '#6b7a99',
      background: '#fafbfd',
      borderTop: '1px solid #edf0f7',
      textAlign: 'center',
    },
    footer: {
      borderTop: '2px solid #1a2744',
      padding: '8px 28px',
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '8pt',
      color: '#888',
      background: '#fafbfd',
    },
    noPhotos: {
      color: '#aaa',
      fontStyle: 'italic',
      fontSize: '9pt',
      padding: '8px 0',
    },
  };

  const F = (label, value) => (
    <div style={styles.field}>
      <div style={styles.fieldLabel}>{label}</div>
      <div style={styles.fieldValue}>{value || '\u2014'}</div>
    </div>
  );

  return (
    <div style={styles.page}>
      {/* HEADER */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.headerCompany}>RELIABLE OILFIELD SERVICES</div>
          <div style={styles.headerSub}>Work Order Report</div>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.headerWO}>WO #{d.wo_number}</div>
          <div style={styles.headerCustomer}>{d.customer}</div>
          <div style={styles.headerLocation}>{d.location}</div>
          <div style={styles.headerDate}>{d.date_long}</div>
        </div>
      </div>

      <div style={styles.body}>

        {/* JOB DETAILS */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>Job Details</div>
          <div style={styles.cardBody}>
            <div style={styles.grid3}>
              {F('Job Type', d.job_type)}
              {F('Date', d.date_long)}
              {F('Truck #', d.truck_number)}
              {F('Customer', d.customer)}
              {F('Location', d.location)}
              {F('Type of Work', d.type_of_work)}
              {F('Start Time', d.start_time)}
              {F('Departure Time', d.departure_time)}
              {F('Asset Tag', d.asset_tag)}
              {F('Work Area', d.work_area)}
              {F('Site Contact', d.contact)}
              {F('Customer WO #', d.customer_wo_number)}
            </div>
          </div>
        </div>

        {/* FIELD TECHNICIANS */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>Field Technician{techPlural} ({d.tech_count})</div>
          <div style={styles.cardBody}>
            {(d.technicians || []).map((t, i) => (
              <span key={i} style={styles.techBadge}>{t}</span>
            ))}
          </div>
        </div>

        {/* DESCRIPTION OF WORK */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>Description of Work</div>
          <div style={styles.cardBody}>
            <div style={styles.descBox}>{d.description_of_work || '\u2014'}</div>
          </div>
        </div>

        {/* EQUIPMENT */}
        {d.equipment && d.equipment.length > 0 && (
          <div style={styles.card}>
            <div style={styles.cardHeader}>Equipment / Systems Serviced</div>
            <div style={styles.cardBody}>
              {d.equipment.map((eq, i) => (
                <span key={i} style={styles.equipBadge}>{eq}</span>
              ))}
            </div>
          </div>
        )}

        {/* PARTS */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>Parts Used ({(d.parts || []).length})</div>
          {(d.parts || []).length > 0 ? (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>SKU</th>
                  <th style={styles.th}>Description</th>
                  <th style={{...styles.thRight, width:'60px'}}>Qty</th>
                  <th style={{...styles.thRight, width:'90px'}}>Unit Price</th>
                  <th style={{...styles.thRight, width:'90px'}}>Total</th>
                </tr>
              </thead>
              <tbody>
                {d.parts.map((p, i) => (
                  <tr key={i} style={{background: i % 2 === 0 ? '#fff' : '#fafbfd'}}>
                    <td style={styles.tdBold}>{p.sku}</td>
                    <td style={styles.td}>{p.description}</td>
                    <td style={styles.tdRight}>{p.qty}</td>
                    <td style={styles.tdRight}>{p.unit_price}</td>
                    <td style={styles.tdRight}>{p.line_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={styles.cardBody}>
              <span style={styles.noPhotos}>No parts used</span>
            </div>
          )}
        </div>

        {/* COST SUMMARY */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>Cost Summary</div>
          <div style={styles.cardBody}>
            <div style={{maxWidth: '340px', marginLeft: 'auto'}}>
              <div style={styles.costRow}>
                <span style={styles.costLabel}>Parts</span>
                <span style={styles.costValue}>{d.cost_parts}</span>
              </div>
              <div style={styles.costRow}>
                <span style={styles.costLabel}>
                  Mileage ({d.mileage_miles} mi x {d.mileage_rate}/mi)
                </span>
                <span style={styles.costValue}>{d.cost_mileage}</span>
              </div>
              <div style={styles.costRow}>
                <span style={styles.costLabel}>
                  Labor ({d.labor_hours} hrs x {d.labor_rate}/hr x {d.tech_count} tech{techPlural})
                </span>
                <span style={styles.costValue}>{d.cost_labor}</span>
              </div>
              <div style={styles.costRowTotal}>
                <span>TOTAL</span>
                <span>{d.cost_total}</span>
              </div>
            </div>
          </div>
        </div>

        {/* PHOTOS */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>Site Photos ({(d.photos || []).length})</div>
          <div style={styles.cardBody}>
            {(d.photos || []).length > 0 ? (
              <div style={styles.photoGrid}>
                {d.photos.map((ph, i) => (
                  <div key={i} style={styles.photoCell}>
                    <img
                      src={ph.url}
                      alt={ph.caption || 'photo'}
                      style={styles.photoImg}
                      crossOrigin="anonymous"
                    />
                    {ph.caption && (
                      <div style={styles.photoCaption}>{ph.caption}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <span style={styles.noPhotos}>No photos attached</span>
            )}
          </div>
        </div>

      </div>

      {/* FOOTER */}
      <div style={styles.footer}>
        <span>Reliable Oilfield Services \u2014 WO #{d.wo_number} \u2014 {d.customer} / {d.location}</span>
        <span>Generated {d.generated_at}</span>
      </div>
    </div>
  );
}
