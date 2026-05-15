// src/components/ReviewSheet.jsx
//
// Full-screen pre-submit review for FormPage. Appears between tapping the
// Submit button and the actual save/upload/email pipeline. Shows everything
// that's about to send and flags missing items — eliminates the "wait, I
// forgot the customer sig" panic the moment the report is already gone.
//
// The sheet is presentational: it receives a fully-resolved snapshot of the
// form state via `data`, plus onEdit / onConfirm callbacks. It doesn't
// mutate anything itself.

const ICON_OK = '✓';
const ICON_WARN = '⚠';

function Row({ label, value, muted }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', gap: 16, borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: muted ? '#94a3b8' : '#0f172a', textAlign: 'right', fontWeight: muted ? 500 : 600, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function SectionCard({ title, accent = '#1a2332', children, count }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, marginBottom: 12, overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 10px rgba(15,23,42,0.04)' }}>
      <div style={{ background: accent, color: '#fff', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' }}>
        <span>{title}</span>
        {count != null && <span style={{ background: 'rgba(255,255,255,0.18)', padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>{count}</span>}
      </div>
      <div style={{ padding: '10px 14px' }}>{children}</div>
    </div>
  );
}

function fmtMoney(n) {
  const v = parseFloat(n);
  if (!isFinite(v)) return '$0.00';
  return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export default function ReviewSheet({ data, onEdit, onConfirm, saving, saveStatus, saveError }) {
  if (!data) return null;
  const {
    woNumber, pmNumber, jobType, jtConfig, accent,
    warrantyWork,
    customerName, locationName, customerContact, customerWorkOrder,
    truckNumber, typeOfWork, glCode, assetTag, workArea, lastServiceDate,
    date, startTime, departureTime,
    description, reportedIssue, rootCause, showIssueFields,
    techs, equipment, permitsRequired,
    parts, partsTotal,
    miles, costPerMile, mileageTotal,
    laborHours, hourlyRate, billableTechs, laborTotal,
    grandTotal,
    arrestors, flares, heaters, scEquipment, showPMEquipment, showSCEquip,
    gpsLat, gpsLng, gpsAccuracy,
    photos, customerSig, techSignatures, siteSignPhoto,
    arrivalVideo, departureVideo, showVideos,
  } = data;

  // Missing-items checks. Not blocking — just visible so the tech sees them
  // before pushing through. Most teams don't WANT to require sigs/photos
  // because field reality includes signal loss and absent customers.
  const techSigCount = Object.values(techSignatures || {}).filter(Boolean).length;
  const warnings = [];
  if (!customerName)       warnings.push('No customer selected');
  if (!locationName)       warnings.push('No location / well name');
  if (!description)        warnings.push('Description / Work Performed is empty');
  if (!techs || techs.length === 0) warnings.push('No technicians selected');
  if (!customerSig)        warnings.push('Customer signature not captured');
  if (techSigCount === 0)  warnings.push('No tech signatures captured');
  if (showIssueFields && !reportedIssue) warnings.push('Reported Issue is empty (SC requires this)');
  if (!photos || photos.length === 0) warnings.push('No job photos added');
  if (!parts || parts.length === 0) warnings.push('No parts added');

  const photoUrl = (p) => p && p.dataUrl ? p.dataUrl : (p && p.file ? URL.createObjectURL(p.file) : '');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#f1f5f9',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      {/* HEADER */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 2,
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        color: '#fff', padding: '14px 16px',
        boxShadow: '0 2px 10px rgba(15,23,42,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.7, letterSpacing: 1.2, textTransform: 'uppercase' }}>Review before sending</div>
          <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="id-mono">
            {jtConfig && jtConfig.icon} WO·{woNumber || '…'} {customerName && <span style={{ fontFamily: 'inherit', opacity: 0.85, fontWeight: 700 }}>· {customerName}</span>}
          </div>
        </div>
        <button type="button" onClick={onEdit} disabled={saving}
          style={{ background: 'rgba(255,255,255,0.14)', color: '#fff', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: saving ? 0.5 : 1 }}>
          ← Edit
        </button>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '14px 12px 140px' }}>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div style={{ background: '#fef9c3', border: '1.5px solid #facc15', borderRadius: 12, padding: '12px 14px', marginBottom: 12, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#854d0e', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
              {ICON_WARN} {warnings.length} item{warnings.length !== 1 ? 's' : ''} to double-check
            </div>
            {warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 13, color: '#713f12', padding: '3px 0' }}>• {w}</div>
            ))}
            <div style={{ fontSize: 11, color: '#854d0e', marginTop: 6, fontStyle: 'italic' }}>
              These won't block submit — just making sure nothing was missed.
            </div>
          </div>
        )}

        {/* JOB INFO */}
        <SectionCard title="Job Information" accent={accent}>
          <Row label="Job Type" value={jobType} />
          <Row label="Customer" value={customerName} muted={!customerName} />
          <Row label="Location" value={locationName} muted={!locationName} />
          <Row label="Contact" value={customerContact} />
          <Row label="Customer WO #" value={customerWorkOrder} />
          <Row label="Truck" value={truckNumber} />
          <Row label="Type of Work" value={typeOfWork} />
          <Row label="GL Code" value={glCode} />
          <Row label="Asset Tag" value={assetTag} />
          <Row label="Work Area" value={workArea} />
          <Row label="Last Service" value={lastServiceDate} />
          <Row label="Date" value={date} />
          <Row label="Start / Departure" value={(startTime || departureTime) ? `${startTime || '—'} → ${departureTime || '—'}` : null} />
          {warrantyWork && <div style={{ marginTop: 8, padding: '6px 12px', background: '#fef2f2', color: '#991b1b', fontWeight: 800, fontSize: 11, borderRadius: 6, letterSpacing: 0.8, textTransform: 'uppercase', display: 'inline-block' }}>Warranty Work — No Charge</div>}
          {gpsLat && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
              📍 GPS captured: <span className="id-mono">{Number(gpsLat).toFixed(5)}, {Number(gpsLng).toFixed(5)}</span>{gpsAccuracy ? ' ± ' + gpsAccuracy + 'm' : ''}
            </div>
          )}
        </SectionCard>

        {/* TECHS */}
        {techs && techs.length > 0 && (
          <SectionCard title="Technicians" accent={accent} count={techs.length}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {techs.map(t => (
                <span key={t} style={{ padding: '4px 10px', background: '#f0f4ff', border: '1px solid #c7d2fe', borderRadius: 20, fontSize: 12, fontWeight: 700, color: '#3730a3' }}>
                  {t} {techSignatures && techSignatures[t] ? ICON_OK : ''}
                </span>
              ))}
            </div>
          </SectionCard>
        )}

        {/* WORK DESCRIPTION */}
        {(description || reportedIssue || rootCause) && (
          <SectionCard title="Work Description" accent={accent}>
            {showIssueFields && reportedIssue && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Reported Issue</div>
                <div style={{ fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap' }}>{reportedIssue}</div>
              </div>
            )}
            {showIssueFields && rootCause && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Root Cause</div>
                <div style={{ fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap' }}>{rootCause}</div>
              </div>
            )}
            {description && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>{showIssueFields ? 'Work Performed' : 'Description'}</div>
                <div style={{ fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap' }}>{description}</div>
              </div>
            )}
            {equipment && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Equipment / SNs</div>
                <div style={{ fontSize: 13, color: '#0f172a' }}>{equipment}</div>
              </div>
            )}
            {permitsRequired && permitsRequired.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Permits</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {permitsRequired.map(p => <span key={p} style={{ padding: '3px 9px', background: '#fef3c7', borderRadius: 12, fontSize: 11, fontWeight: 700, color: '#92400e' }}>{p}</span>)}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* PM EQUIPMENT — arrestors / flares / heaters */}
        {showPMEquipment && (
          <>
            {arrestors && arrestors.length > 0 && arrestors[0].arrestorId && (
              <SectionCard title="Flame Arrestors" accent={accent} count={arrestors.filter(a => a.arrestorId).length}>
                {arrestors.filter(a => a.arrestorId).map((a, i) => (
                  <div key={i} style={{ padding: '6px 0', borderBottom: i < arrestors.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: 13 }}>
                    <strong>#{i + 1} {a.arrestorId}</strong> — {a.condition || 'Good'}{a.filterChanged ? ' · Filter changed' : ''}{a.notes ? ' · ' + a.notes : ''}
                  </div>
                ))}
              </SectionCard>
            )}
            {flares && flares.length > 0 && flares[0].flareId && (
              <SectionCard title="Flares" accent={accent} count={flares.filter(f => f.flareId).length}>
                {flares.filter(f => f.flareId).map((f, i) => (
                  <div key={i} style={{ padding: '6px 0', borderBottom: i < flares.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: 13 }}>
                    <strong>#{i + 1} {f.flareId}</strong> — {f.condition || 'Good'}{f.pilotLit ? ' · Pilot lit' : ' · Pilot OUT'}{f.notes ? ' · ' + f.notes : ''}
                  </div>
                ))}
              </SectionCard>
            )}
            {heaters && heaters.length > 0 && heaters[0].heaterId && (
              <SectionCard title="Heater Treaters" accent={accent} count={heaters.filter(h => h.heaterId).length}>
                {heaters.filter(h => h.heaterId).map((h, i) => (
                  <div key={i} style={{ padding: '6px 0', borderBottom: i < heaters.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: 13 }}>
                    <strong>#{i + 1} {h.heaterId}</strong> — {h.condition || 'Good'}{h.notes ? ' · ' + h.notes : ''}
                  </div>
                ))}
              </SectionCard>
            )}
          </>
        )}

        {/* SC EQUIPMENT */}
        {showSCEquip && scEquipment && scEquipment.length > 0 && (
          <SectionCard title="Equipment Worked On" accent={accent} count={scEquipment.length}>
            {scEquipment.map((eq, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: i < scEquipment.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: 13 }}>
                <strong>{eq.type || eq}</strong>{eq.notes ? ' — ' + eq.notes : ''}
              </div>
            ))}
          </SectionCard>
        )}

        {/* PARTS */}
        {parts && parts.length > 0 && (
          <SectionCard title="Parts" accent={accent} count={parts.length}>
            {parts.map(p => (
              <div key={p.sku} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }} className="id-mono">{p.sku} · {p.qty} × {fmtMoney(p.price)}</div>
                </div>
                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: 14 }} className="id-mono">{fmtMoney((p.price || 0) * (p.qty || 0))}</div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 2px', fontSize: 13, fontWeight: 800 }}>
              <span style={{ color: '#64748b' }}>Parts Subtotal</span>
              <span className="id-mono" style={{ color: '#0f172a' }}>{fmtMoney(partsTotal)}</span>
            </div>
          </SectionCard>
        )}

        {/* COST SUMMARY */}
        {!warrantyWork && (
          <SectionCard title="Cost Summary" accent="#16a34a">
            <Row label="Miles" value={miles && parseFloat(miles) > 0 ? `${miles} mi × ${fmtMoney(costPerMile)}/mi = ${fmtMoney(mileageTotal)}` : null} muted={!miles || parseFloat(miles) === 0} />
            <Row label="Labor" value={laborHours && parseFloat(laborHours) > 0 ? `${laborHours} hrs × ${fmtMoney(hourlyRate)}/hr × ${billableTechs || 1} tech${(billableTechs || 1) !== 1 ? 's' : ''} = ${fmtMoney(laborTotal)}` : null} muted={!laborHours || parseFloat(laborHours) === 0} />
            <Row label="Parts" value={parts && parts.length > 0 ? fmtMoney(partsTotal) : null} muted={!parts || parts.length === 0} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '2px solid #0f172a', fontSize: 15, fontWeight: 900 }}>
              <span style={{ color: '#0f172a' }}>GRAND TOTAL</span>
              <span style={{ color: '#e65c00' }} className="id-mono">{fmtMoney(grandTotal)}</span>
            </div>
          </SectionCard>
        )}

        {/* PHOTOS */}
        {photos && photos.length > 0 && (
          <SectionCard title="Job Photos" accent={accent} count={photos.length}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 }}>
              {photos.map((p, i) => (
                <div key={p.id || i} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 6, overflow: 'hidden', background: '#e2e8f0', border: '1px solid #cbd5e1' }}>
                  <img src={photoUrl(p)} alt={p.caption || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <div style={{ position: 'absolute', top: 3, left: 3, background: 'rgba(15,31,56,0.82)', color: '#fff', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 800 }} className="id-mono">{i + 1}</div>
                  {p.caption && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78), transparent)', color: '#fff', padding: '14px 5px 4px', fontSize: 9, fontWeight: 600, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption}</div>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* SIGNATURES */}
        <SectionCard title="Signatures" accent={accent}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Customer {customerSig ? ICON_OK : ICON_WARN}</div>
              {customerSig
                ? <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, padding: 4 }}><img src={customerSig} alt="Customer signature" style={{ width: '100%', height: 60, objectFit: 'contain', display: 'block' }} /></div>
                : <div style={{ background: '#fef9c3', border: '1px dashed #facc15', borderRadius: 6, padding: '14px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#854d0e' }}>Not captured</div>}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Techs ({techSigCount}/{(techs || []).length})</div>
              {techSigCount > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(techSignatures || {}).filter(([, v]) => v).map(([name, dataUrl]) => (
                    <div key={name} style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, padding: 3 }}>
                      <img src={dataUrl} alt={name + ' signature'} style={{ width: '100%', height: 28, objectFit: 'contain', display: 'block' }} />
                      <div style={{ fontSize: 9, color: '#64748b', textAlign: 'center', marginTop: 1 }}>{name}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ background: '#fef9c3', border: '1px dashed #facc15', borderRadius: 6, padding: '14px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#854d0e' }}>None captured</div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* VIDEOS */}
        {showVideos && (arrivalVideo || departureVideo) && (
          <SectionCard title="Videos" accent={accent}>
            <Row label="Arrival" value={arrivalVideo ? '✓ recorded' : null} muted={!arrivalVideo} />
            <Row label="Departure" value={departureVideo ? '✓ recorded' : null} muted={!departureVideo} />
          </SectionCard>
        )}

        {/* Site Sign Photo */}
        {siteSignPhoto && (
          <SectionCard title="Site Sign Photo" accent={accent}>
            <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #cbd5e1' }}>
              <img src={typeof siteSignPhoto === 'string' ? siteSignPhoto : URL.createObjectURL(siteSignPhoto)} alt="Site sign" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
            </div>
          </SectionCard>
        )}
      </div>

      {/* STICKY CONFIRM BAR */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 3,
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderTop: '1px solid #e2e8f0',
        boxShadow: '0 -4px 20px rgba(15,23,42,0.08)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '10px 14px 12px' }}>
          {saveError && (
            <div style={{ background: '#fef2f2', border: '1.5px solid #ef4444', borderRadius: 9, padding: '10px 14px', marginBottom: 10, fontSize: 13, color: '#991b1b', fontWeight: 600 }}>
              ⚠️ {saveError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onEdit} disabled={saving}
              style={{ flex: '0 0 38%', padding: 14, background: '#fff', color: '#64748b', border: '1.5px solid #cbd5e1', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1, fontFamily: 'inherit' }}>
              ← Edit
            </button>
            <button type="button" onClick={onConfirm} disabled={saving}
              style={{ flex: 1, padding: 14, background: saving ? '#9ca3af' : `linear-gradient(135deg, ${accent || '#1a2332'} 0%, #e65c00 100%)`, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 900, fontSize: 15, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : '0 4px 14px rgba(0,0,0,0.22)', fontFamily: 'inherit', letterSpacing: 0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {saving ? `⏳ ${saveStatus || 'Sending…'}` : `📧 Send Report`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
