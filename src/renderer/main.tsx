import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { StudioEvent } from '../main/preload';
import type { Project, ControllerSnapshot } from './global';
import './style.css';

type Tab = 'overview' | 'agents' | 'logs';
type RunMode = 'status' | 'dry-run' | 'execute';
interface ActiveRun { projectId: string; mode: string; startedAt: number }

function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(() => localStorage.getItem('autodev:selected') ?? '');
  const [tab, setTab] = useState<Tab>('overview');
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [activeInfo, setActiveInfo] = useState<ActiveRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [snapshot, setSnapshot] = useState<ControllerSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approval, setApproval] = useState('');

  const project = projects.find(p => p.id === selected);
  const elapsed = activeInfo ? Math.max(0, Math.floor((clock - activeInfo.startedAt) / 1000)) : 0;
  const duration = [Math.floor(elapsed / 3600), Math.floor((elapsed % 3600) / 60), elapsed % 60]
    .map(n => String(n).padStart(2, '0')).join(':');

  const refresh = async (): Promise<void> => {
    const all = await window.studio.projects();
    setProjects(all);
    setSelected(current => all.some(p => p.id === current)
      ? current : (all.find(p => p.id === localStorage.getItem('autodev:selected'))?.id ?? all[0]?.id ?? ''));
  };

  useEffect(() => {
    void refresh().catch(e => setError(String(e)));
    void window.studio.runInfo().then(info => {
      setBusy(Boolean(info));
      setActiveInfo(info);
    }).catch(e => setError(String(e)));
    const ticker = setInterval(() => setClock(Date.now()), 1000);
    const unsubscribe = window.studio.onEvent(event => {
      setEvents(previous => [...previous.slice(-1999), event]);
      if (event.type === 'start') {
        setBusy(true);
        setActiveInfo({ projectId: event.projectId ?? '', mode: event.mode ?? 'unknown', startedAt: event.time });
      }
      if (event.type === 'exit') {
        setBusy(false);
        setActiveInfo(null);
      }
    });
    return () => { clearInterval(ticker); unsubscribe(); };
  }, []);

  useEffect(() => {
    if (selected) localStorage.setItem('autodev:selected', selected);
    else localStorage.removeItem('autodev:selected');
    setConfirmOpen(false);
    setApproval('');
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

  const add = async (): Promise<void> => {
    try {
      setError('');
      const p = await window.studio.addProject();
      await refresh();
      if (p) { setSelected(p.id); setTab('overview'); }
    } catch (e) { setError(String(e)); }
  };

  const remove = async (): Promise<void> => {
    if (!selected || busy || !window.confirm('Projekt nur aus Studio entfernen? Dateien bleiben erhalten.')) return;
    try {
      setError('');
      await window.studio.removeProject(selected);
      setSelected('');
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const run = async (mode: RunMode): Promise<void> => {
    if (!selected || busy) return;
    try {
      setError('');
      if (mode === 'execute' && approval !== `EXECUTE ${project?.name ?? ''}`) {
        throw new Error('Projektfreigabe fehlt');
      }
      const token = mode === 'execute' ? approval : undefined;
      setEvents([]);
      setBusy(true);
      setTab('logs');
      await window.studio.start(selected, mode, token);
      if (mode === 'execute') { setConfirmOpen(false); setApproval(''); }
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    try { await window.studio.stop(); }
    catch (e) { setError(String(e)); }
  };

  const logs = <div className="console" role="log" aria-live="off">
    {events.length === 0
      ? <div className="empty">Noch keine Ausgabe. Starte eine Statusabfrage oder einen Dry-Run.</div>
      : events.map((event, index) => <div key={index} className={`entry ${event.type}`}>
        <time>{new Date(event.time).toLocaleTimeString('de-DE')}</time>
        <span>{event.type === 'start' ? `Start: ${event.mode} · ${event.project}`
          : event.type === 'exit' ? `Prozess beendet · Exit ${event.code ?? 'null'} · Signal ${event.signal ?? 'none'}`
            : event.message}</span>
      </div>)}
  </div>;

  return <div className="studio-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">A</div><div><strong>AutoDev <em>Studio</em></strong><small>Agentensteuerung für lokale Projekte</small></div></div>
      <div className="topbar-right"><span className="version">v0.2.2</span><span className={`status ${busy ? 'busy' : ''}`}>{busy ? 'Prozess läuft' : 'Bereit'}</span></div>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-title"><span>PROJEKTE</span><button type="button" title="Projekt hinzufügen" onClick={() => void add()}>+</button></div>
        <div className="project-list">{projects.length === 0
          ? <p className="muted">Noch kein Projekt hinzugefügt.</p>
          : projects.map(p => <button type="button" key={p.id} className={`project ${selected === p.id ? 'selected' : ''}`} onClick={() => { setSelected(p.id); setTab('overview'); }}>
            <strong>{p.name}</strong><small>{p.path}</small>
          </button>)}</div>
        <div className="sidebar-bottom"><span className="safe-indicator">● Lokaler Controller</span><small>Keine automatische Ausführung</small></div>
      </aside>

      <section className="content">
        <div className="project-heading">
          <div className="project-identity"><h1>{project?.name ?? 'Projekt auswählen'}</h1><p title={project?.path}>{project?.path ?? 'Füge links ein Projekt hinzu.'}</p></div>
          <div className="heading-actions">{busy && <button className="danger" onClick={() => void stop()}>Prozess stoppen</button>}
            <button className="quiet" disabled={!selected || busy} onClick={() => void remove()}>Entfernen</button></div>
        </div>

        <nav className="tabs" aria-label="Arbeitsbereiche">
          <button className={tab === 'overview' ? 'active' : ''} aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => setTab('overview')}>Übersicht</button>
          <button className={tab === 'agents' ? 'active' : ''} aria-current={tab === 'agents' ? 'page' : undefined} onClick={() => setTab('agents')}>Agenten</button>
          <button className={tab === 'logs' ? 'active' : ''} aria-current={tab === 'logs' ? 'page' : undefined} onClick={() => setTab('logs')}>Protokoll {events.length > 0 ? <span className="count">{events.length}</span> : null}</button>
        </nav>

        {tab === 'overview' && <div className="view overview">
          <div className="view-intro"><div><h2>Controller-Übersicht</h2><p>Zustand des ausgewählten Projekts · Aktualisierung alle 5 Sekunden</p></div></div>
          {snapshotError ? <div className="error" role="alert">{snapshotError}</div>
            : !selected ? <div className="empty-state">Wähle links ein Projekt aus.</div>
              : !snapshot ? <div className="empty-state">Lade Controller-Zustand …</div>
                : !snapshot.hasState ? <div className="empty-state">Für dieses Projekt existiert noch keine AutoDev-Zustandsdatei.</div>
                  : <>
                    <div className="metric-grid">
                      <div className="metric"><small>Aktuelles Issue</small><strong>{snapshot.currentIssue === null ? 'Keines' : `#${snapshot.currentIssue}`}</strong></div>
                      <div className="metric"><small>Phase</small><strong>{snapshot.checkpoint?.phase ?? 'Inaktiv'}</strong></div>
                      <div className="metric"><small>Abgeschlossen</small><strong>{snapshot.processedIssues.length}</strong></div>
                      <div className="metric"><small>Fehlgeschlagen</small><strong>{snapshot.failedIssues.length}</strong></div>
                    </div>
                    <div className="summary-line">{snapshot.checkpoint
                      ? <><span className="checkpoint-indicator">Checkpoint vorhanden</span> Issue #{snapshot.checkpoint.issueNumber} · {snapshot.checkpoint.phase} · {snapshot.checkpoint.reason}</>
                      : <><span className="good-indicator">● Kein offener Checkpoint</span> · Abgeschlossene Issues: {snapshot.processedIssues.join(', ') || 'Keine'}</>}</div>
                  </>}
          <div className="quick-actions"><div><h3>Sicher ausprobieren</h3><p>Diese Aktionen starten weder Builder noch Git-Push.</p></div><div className="button-group"><button disabled={!selected || busy} onClick={() => void run('status')}>Status abrufen</button><button disabled={!selected || busy} onClick={() => void run('dry-run')}>Dry-Run starten</button></div></div>
          <button className="link-action" disabled={!selected} onClick={() => setTab('agents')}>Zur Agentensteuerung →</button>
        </div>}

        {tab === 'agents' && <div className="view agents">
          <div className="view-intro"><div><h2>Agentensteuerung</h2><p>Builder und Reviewer werden vom bestehenden AutoDev Core koordiniert.</p></div></div>
          <div className="metric-grid three">
            <div className="metric"><small>Agent / Modus</small><strong>{busy ? (activeInfo?.mode === 'execute' ? 'Builder → Reviewer' : activeInfo?.mode ?? 'Aktiv') : 'Bereit'}</strong></div>
            <div className="metric"><small>Laufzeit</small><strong className="mono">{duration}</strong></div>
            <div className="metric"><small>Checkpoint</small><strong>{snapshot?.checkpoint ? `#${snapshot.checkpoint.issueNumber} · ${snapshot.checkpoint.phase}` : 'Keiner'}</strong></div>
          </div>
          {snapshot?.checkpoint && <div className="checkpoint-detail">Checkpoint: {snapshot.checkpoint.reason} · Session: {snapshot.checkpoint.sessionId ?? 'Fehlt – Core muss Wiederaufnahme verweigern'}</div>}
          <div className="run-panel"><div><h3>Produktiver Agentenlauf</h3><p>Kann Dateien ändern, committen, pushen und Issues schließen. Erfordert eine ausdrückliche Freigabe.</p></div><button className="danger" disabled={!project || busy} onClick={() => { setApproval(''); setConfirmOpen(true); }}>Ausführung vorbereiten</button></div>
          <div className="agent-footnote">Ein Stopp sendet SIGTERM und erforderlichenfalls SIGKILL. Er ist keine garantierte Checkpoint-Pause. Der Core prüft Wiederaufnahme und Doppelstarts.</div>
          <button className="link-action" onClick={() => setTab('logs')}>Live-Protokoll öffnen →</button>
        </div>}

        {tab === 'logs' && <div className="view log-view">
          <div className="log-toolbar"><div><h2>Live-Protokoll</h2><p>{busy ? `Laufender Prozess · ${duration}` : 'Ausgabe des letzten Laufs in dieser Sitzung'}</p></div><button className="quiet" disabled={busy} onClick={() => setEvents([])}>Protokoll leeren</button></div>
          {logs}
        </div>}

        {error && <div className="error floating-error" role="alert">{error}<button onClick={() => setError('')}>Schließen</button></div>}
      </section>
    </div>

    {confirmOpen && project && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { setConfirmOpen(false); setApproval(''); } }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-icon">!</div><h2 id="confirm-title">Produktiven Lauf freigeben?</h2>
        <p>AutoDev kann im Projekt <strong>{project.name}</strong> Code verändern, Tests ausführen, Commits erstellen, nach GitHub pushen und Issues schließen.</p>
        <p>Wiederaufnahme und vorhandene Checkpoints prüft der AutoDev Core. Eine Freigabe gilt nur für diesen Start.</p>
        <label htmlFor="approve-text">Zur Bestätigung exakt <code>EXECUTE {project.name}</code> eingeben:</label>
        <input id="approve-text" autoFocus autoComplete="off" spellCheck={false} value={approval} onChange={event => setApproval(event.target.value)} placeholder={`EXECUTE ${project.name}`} />
        <div className="modal-actions"><button className="quiet" onClick={() => { setConfirmOpen(false); setApproval(''); }}>Abbrechen</button><button className="danger" disabled={busy || approval !== `EXECUTE ${project.name}`} onClick={() => void run('execute')}>Produktiven Lauf starten</button></div>
      </div>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
