import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { StudioEvent } from '../main/preload';
import type { Project, ControllerSnapshot } from './global';
import './style.css';
function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(() => localStorage.getItem('autodev:selected') ?? '');
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [executeOpen, setExecuteOpen] = useState(false);
  const [approval, setApproval] = useState('');
  const [activeInfo, setActiveInfo] = useState<{ projectId: string; mode: string; startedAt: number } | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [snapshot, setSnapshot] = useState<ControllerSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const refresh = async (): Promise<void> => {
    const all = await window.studio.projects(); setProjects(all);
    setSelected(current => all.some(p => p.id === current) ? current : (all.find(p => p.id === localStorage.getItem('autodev:selected'))?.id ?? all[0]?.id ?? ''));
  };
  useEffect(() => {
    void refresh();
    void window.studio.runInfo().then(info => { setBusy(Boolean(info)); setActiveInfo(info); }).catch(e => setError(String(e)));
    const ticker = setInterval(() => setClock(Date.now()), 1000);
    const unsubscribe = window.studio.onEvent(event => {
      setEvents(previous => [...previous.slice(-1999), event]);
      if (event.type === 'start') { setBusy(true); setActiveInfo({ projectId: selected, mode: event.mode ?? 'unknown', startedAt: event.time }); }
      if (event.type === 'exit') { setBusy(false); setActiveInfo(null); }
    });
    return () => { clearInterval(ticker); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (selected) localStorage.setItem('autodev:selected', selected);
    else localStorage.removeItem('autodev:selected');
    setSnapshot(null);
    setSnapshotError('');
    if (!selected) return;
    let cancelled = false;
    const reload = (): void => {
      void window.studio.snapshot(selected).then(value => {
        if (!cancelled) { setSnapshot(value); setSnapshotError(''); }
      }).catch(e => { if (!cancelled) setSnapshotError(String(e)); });
    };
    reload();
    const timer = setInterval(reload, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [selected]);
  const remove = async (): Promise<void> => {
    if (!selected || busy || !confirm('Dieses Projekt nur aus Studio entfernen? Projektdateien bleiben erhalten.')) return;
    try {
      setError('');
      await window.studio.removeProject(selected);
      setSelected('');
      await refresh();
    } catch (e) { setError(String(e)); }
  };
  const project = projects.find(p => p.id === selected);
  const elapsed = activeInfo ? Math.max(0, Math.floor((clock - activeInfo.startedAt) / 1000)) : 0;
  const duration = `${Math.floor(elapsed / 3600).toString().padStart(2, '0')}:${Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const add = async (): Promise<void> => { try { setError(''); const p = await window.studio.addProject(); await refresh(); if (p) setSelected(p.id); } catch (e) { setError(String(e)); } };
  const run = async (mode: 'status' | 'dry-run' | 'execute'): Promise<void> => {
    if (!selected) return;
    try {
      setError(''); setEvents([]); setBusy(true);
      const expected = `EXECUTE ${project?.name ?? ''}`;
      if (mode === 'execute' && approval !== expected) throw new Error('Projektfreigabe fehlt');
      await window.studio.start(selected, mode, mode === 'execute' ? approval : undefined);
      if (mode === 'execute') { setExecuteOpen(false); setApproval(''); }
    } catch (e) { setError(String(e)); setBusy(false); }
  };
  return <main>
    <header><div><div className="eyebrow">LOCAL-FIRST AUTOMATION</div><h1>AutoDev <span>Studio</span></h1><p>Projektkontrolle und nachvollziehbare Agentenläufe. Keine Cloud-Anmeldung erforderlich.</p></div><div className="phase">PHASE 02.2 · AGENT CONTROL</div></header>
    <div className="layout"><aside><div className="section-head"><h2>Projekte</h2><button onClick={() => void add()}>+ Hinzufügen</button></div>
      {projects.length === 0 ? <p className="muted">Wähle dein LaceFrame-Verzeichnis aus, um AutoDev einzubinden.</p> : projects.map(p => <button key={p.id} className={'project '+(selected===p.id?'selected':'')} onClick={() => setSelected(p.id)}><b>{p.name}</b><small>{p.path}</small></button>)}
      <div className="aside-foot">Der Core bleibt im jeweiligen Projekt. Studio führt nur explizit erlaubte Befehle aus.</div>
    </aside><section><div className="panel"><div className="section-head"><div><h2>{project?.name ?? 'Kein Projekt ausgewählt'}</h2><p className="muted">{project?.path ?? 'Bitte ein Projekt hinzufügen'}</p></div><span className={'dot '+(busy?'running':'')}>{busy?'Läuft':'Bereit'}</span></div>
      <div className="actions"><button className="secondary" disabled={!selected||busy} onClick={() => void remove()}>Projekt entfernen</button><button disabled={!selected||busy} onClick={() => void run('status')}>Status abrufen</button><button disabled={!selected||busy} onClick={() => void run('dry-run')}>Dry-Run starten</button><button className="danger" disabled={!busy} onClick={() => void window.studio.stop()}>Prozess stoppen</button></div>
      <p className="notice">Produktive Läufe können Code ändern, Commits erstellen, zu GitHub pushen und Issues schließen. AutoDev Core prüft seine eigenen Sicherheitsbedingungen.</p></div>
      <div className="panel agent-control"><div className="section-head"><h2>Agent Control Center</h2><span className={'dot '+(busy?'running':'')}>{busy ? 'Aktiver Prozess' : 'Kein Prozess'}</span></div>
        <div className="agent-grid"><div><small>Agent / Modus</small><strong>{busy ? (activeInfo?.mode === 'execute' ? 'Builder → Reviewer → Quality-Gates' : activeInfo?.mode ?? 'Aktiv') : 'Bereit'}</strong></div><div><small>Laufzeit</small><strong className="mono">{duration}</strong></div><div><small>Checkpoint</small><strong>{snapshot?.checkpoint ? `${snapshot.checkpoint.phase} · #${snapshot.checkpoint.issueNumber}` : 'Keiner'}</strong></div></div>
        {snapshot?.checkpoint && <p className="muted small">Wiederaufnahme wird ausschließlich vom AutoDev Core validiert. Session-ID: {snapshot.checkpoint.sessionId ?? 'FEHLT – gesperrt durch Core'}.</p>}
        {!executeOpen ? <button className="execute-trigger" disabled={!project || busy} onClick={() => { setExecuteOpen(true); setApproval(''); }}>Produktiven Agentenlauf vorbereiten</button> : <div className="approval"><b>Produktive Ausführung freigeben</b><p>Der AutoDev Core kann automatisch Issues bearbeiten, Dateien verändern, committen, pushen und GitHub-Issues schließen. Bei vorhandenem Checkpoint entscheidet nur der Core über einen sicheren Resume. Keine automatische Freigabe bei App-Neustart.</p><label htmlFor="approval">Tippe <code>EXECUTE {project?.name}</code> zur Bestätigung:</label><input id="approval" value={approval} spellCheck={false} autoComplete="off" onChange={event => setApproval(event.target.value)} placeholder={`EXECUTE ${project?.name ?? ''}`} /><div className="actions"><button className="danger execute-trigger" disabled={!project || busy || approval !== `EXECUTE ${project.name}`} onClick={() => void run('execute')}>Jetzt produktiv ausführen</button><button className="secondary" onClick={() => { setExecuteOpen(false); setApproval(''); }}>Abbrechen</button></div></div>}
        {busy && <p className="muted small">Stoppen sendet SIGTERM und beendet nach 4 Sekunden nötigenfalls den Prozessbaum. Das ist kein garantierter Checkpoint-Pause-Befehl.</p>}
      </div>
      <div className="panel dashboard">
        <div className="section-head"><h2>Controller-Dashboard</h2><span className="muted">Automatische Aktualisierung · 5 s</span></div>
        {snapshotError ? <p className="error">{snapshotError}</p> : !selected ? <p className="muted">Projekt auswählen.</p> : !snapshot ? <p className="muted">Lade Controller-Zustand …</p> : !snapshot.hasState ? <p className="muted">Für dieses Projekt existiert noch keine AutoDev-Zustandsdatei.</p> : <>
          <div className="metrics">
            <div><small>Aktuelles Issue</small><strong>{snapshot.currentIssue === null ? 'Keines' : `#${snapshot.currentIssue}`}</strong></div>
            <div><small>Phase</small><strong>{snapshot.checkpoint?.phase ?? 'Inaktiv'}</strong></div>
            <div><small>Abgeschlossen</small><strong>{snapshot.processedIssues.length}</strong></div>
            <div><small>Fehlgeschlagen</small><strong>{snapshot.failedIssues.length}</strong></div>
          </div>
          {snapshot.checkpoint ? <div className="checkpoint"><b>Gesicherter Checkpoint · Issue #{snapshot.checkpoint.issueNumber}</b><p>Grund: {snapshot.checkpoint.reason} · Phase: {snapshot.checkpoint.phase}</p><p>Session: {snapshot.checkpoint.sessionId ?? 'Keine Session-ID – Wiederaufnahme nicht sicher'}</p><small>{snapshot.checkpoint.timestamp}</small></div> : <p className="muted">Kein offener Checkpoint.</p>}
          <p className="muted small">Abgeschlossene Issues: {snapshot.processedIssues.join(', ') || 'Keine'} · Fehler: {snapshot.failedIssues.join(', ') || 'Keine'}</p>
        </>}
      </div>
      <div className="panel logs"><div className="section-head"><h2>Live-Protokoll</h2><button onClick={() => setEvents([])}>Leeren</button></div>
        <div className="console" role="log" aria-live="polite">{events.length===0?<span className="muted">Noch keine Ausgabe. Starte eine Statusabfrage oder einen Dry-Run.</span>:events.map((e,i)=><div key={i} className={'entry '+e.type}><time>{new Date(e.time).toLocaleTimeString('de-DE')}</time><span>{e.type === 'start' ? `Start: ${e.mode} · ${e.project}` : e.type==='exit' ? `Prozess beendet · Exit ${e.code ?? 'null'} · Signal ${e.signal ?? 'none'}` : e.message}</span></div>)}</div></div>
      {error&&<div className="error" role="alert">{error}</div>}
      </section></div>
    <footer>AutoDev Studio v0.2.2 · Linux / macOS / Windows · Electron + React + TypeScript</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
