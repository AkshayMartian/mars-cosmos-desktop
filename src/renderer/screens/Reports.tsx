import { useEffect, useState } from 'react'
import { DEAD_DAYS, REPORT_PERIODS, REPORT_TABS, chipTone, fmtCell, type ReportDto, type ReportPeriod, type ReportTab, type ReportTable } from '@shared/reports'
import { useMsg } from '../ui'

export function Reports() {
  const [tab, setTab] = useState<ReportTab>('sales')
  const [period, setPeriod] = useState<ReportPeriod>('30')
  const [dead, setDead] = useState(30)
  const [r, setR] = useState<ReportDto | null>(null)
  const { run, setMsg, node } = useMsg()

  useEffect(() => {
    let stale = false
    setR(null)
    void run(() => window.api.reports.get(tab, period, dead)).then((d) => { if (!stale && d) setR(d) })
    return () => { stale = true }
  }, [tab, period, dead, run])

  async function save(kind: 'Excel' | 'PDF') {
    const path = await run(() => (kind === 'Excel' ? window.api.reports.exportExcel(tab, period, dead) : window.api.reports.exportPdf(tab, period, dead)))
    if (path) setMsg({ ok: true, text: `${kind} saved: ${path}` })
    else if (path === null) setMsg(null) // cancelled
  }

  const showPeriod = REPORT_TABS.find(([k]) => k === tab) && !['dead', 'stock', 'size'].includes(tab)
  return (
    <>
      <div className="head">
        <h1>Reports</h1>
        <div className="row">
          {showPeriod && (
            <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)}>
              {REPORT_PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          <button className="btn" disabled={!r} onClick={() => void save('Excel')}>Export Excel</button>
          <button className="btn" disabled={!r} onClick={() => void save('PDF')}>Export PDF</button>
        </div>
      </div>
      {node}
      <div className="panel">
        <div className="tabs" role="tablist">{REPORT_TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === 'dead' && (
          <div className="row"><div className="f" style={{ maxWidth: 220 }}><label htmlFor="rd">Not sold in</label>
            <select id="rd" value={dead} onChange={(e) => setDead(Number(e.target.value))}>{DEAD_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}</select></div></div>
        )}
        {!r ? <div className="empty">Loading…</div> : (
          <>
            {r.kpis.length > 0 && (
              <div className="kpis">{r.kpis.map((k) => <div key={k.label} className="kpi"><b>{fmtCell({ kind: k.kind }, k.value)}</b><span>{k.label}</span></div>)}</div>
            )}
            {r.hint && tab === 'size' && <p className="hint">{r.hint}</p>}
            <div className={r.even ? 'cols even' : undefined} style={r.even ? undefined : { display: 'flex', flexDirection: 'column', gap: 10 }}>
              {r.tables.map((t) => <Table key={t.id} t={t} />)}
            </div>
            {r.hint && tab !== 'size' && <div className="hint">{r.hint}</div>}
          </>
        )}
      </div>
    </>
  )
}

function Table({ t }: { t: ReportTable }) {
  return (
    <div className="tw"><table>
      <thead><tr>{t.columns.map((c) => <th key={c.key} className={c.right ? 'r' : undefined}>{c.label}</th>)}</tr></thead>
      <tbody>
        {t.rows.length ? t.rows.map((row, i) => (
          <tr key={i}>{t.columns.map((c) => (
            <td key={c.key} className={[c.right ? 'r num' : '', c.kind === 'mono' ? 'mono' : ''].join(' ').trim() || undefined}>
              {c.kind === 'chip' ? <span className={`chip ${chipTone(row[c.key] ?? null)}`}>{row[c.key]}</span> : fmtCell(c, row[c.key] ?? null)}
            </td>
          ))}</tr>
        )) : <tr><td colSpan={t.columns.length} className="empty">{t.empty}</td></tr>}
        {t.total && (
          <tr>{t.columns.map((c) => <td key={c.key} className={c.right ? 'r num' : undefined}><b>{c.key in t.total! ? fmtCell(c, t.total![c.key] ?? null) : ''}</b></td>)}</tr>
        )}
      </tbody>
    </table></div>
  )
}
