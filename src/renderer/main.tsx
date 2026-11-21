import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { StudioEvent } from '../main/preload';
import type { Project, ControllerSnapshot, RunRecord, StudioIssue, SimulationResult, GitPreflight, ProviderDiagnostics, StandaloneStatus, SandboxProbeResult, ReviewerToolProbe, IsolatedQualityProbe, QualityScriptProbeResult, FullPipelineProbeResult, OfflineKiloProbeResult } from './global';
import './style.css';

type Tab = 'overview' | 'agents' | 'logs' | 'history' | 'issues';
type RunMode = 'status' | 'dry-run' | 'execute';
interface ActiveRun { projectId: string; mode: string; startedAt: number }

function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(() => localStorage.getItem('autodev:selected') ?? '');
  const [tab, setTab] = useState<Tab>('overview');
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [issues, setIssues] = useState<StudioIssue[]>([]);
  const [gitStatus, setGitStatus] = useState<GitPreflight | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProviderDiagnostics | null>(null);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const [sandboxProbe, setSandboxProbe] = useState<SandboxProbeResult | null>(null);
  const [sandboxChecking, setSandboxChecking] = useState(false);
  const [sandboxError, setSandboxError] = useState('');
  const [reviewerProbe, setReviewerProbe] = useState<ReviewerToolProbe | null>(null);
  const [reviewerChecking, setReviewerChecking] = useState(false);
  const [qualityProbe, setQualityProbe] = useState<IsolatedQualityProbe | null>(null);
  const [qualityChecking, setQualityChecking] = useState(false);
  const [qualityScriptProbe, setQualityScriptProbe] = useState<QualityScriptProbeResult | null>(null);
  const [qualityScriptChecking, setQualityScriptChecking] = useState(false);
  const [fullPipelineProbe, setFullPipelineProbe] = useState<FullPipelineProbeResult | null>(null);
  const [fullPipelineChecking, setFullPipelineChecking] = useState(false);
  const [offlineKiloProbe, setOfflineKiloProbe] = useState<OfflineKiloProbeResult | null>(null);
  const [offlineKiloChecking, setOfflineKiloChecking] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const [gitError, setGitError] = useState('');
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [simulating, setSimulating] = useState<number | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [issuesError, setIssuesError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyRun, setHistoryRun] = useState<string | null>(null);
  const [savedLog, setSavedLog] = useState('');
  const [activeInfo, setActiveInfo] = useState<ActiveRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [snapshot, setSnapshot] = useState<ControllerSnapshot | null>(null);
  const [studioStatus, setStudioStatus] = useState<StandaloneStatus | null>(null);
  const [studioStatusError, setStudioStatusError] = useState('');
  const [snapshotError, setSnapshotError] = useState('');
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agentInfoOpen, setAgentInfoOpen] = useState(false);
  const [approval, setApproval] = useState('');

  const project = projects.find(p => p.id === selected);
  const canRun = Boolean(project?.hasCore);
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
    setStudioStatus(null);
    setStudioStatusError('');
    setHistory([]);
    setIssues([]);
    setIssuesError('');
    setGitStatus(null);
    setGitError('');
    setDiagnostics(null);
    setDiagnosticsError('');
    setSandboxProbe(null);
    setSandboxError('');
    setReviewerProbe(null);
    setQualityProbe(null);
    setQualityScriptProbe(null);
    setFullPipelineProbe(null);
    setOfflineKiloProbe(null);
    setSimulation(null);
    setHistoryRun(null);
    setSavedLog('');
    setHistoryError('');
    if (!selected) return;
    let cancelled = false;
    const reload = (): void => {
      void window.studio.snapshot(selected).then(value => {
        if (!cancelled) { setSnapshot(value); setSnapshotError(''); }
      }).catch(e => { if (!cancelled) setSnapshotError(String(e)); });
    };
    reload();
    const refreshStandalone = (): void => {
      void window.studio.studioStatus(selected).then(value => {
        if (!cancelled) { setStudioStatus(value); setStudioStatusError(''); }
      }).catch(e => { if (!cancelled) setStudioStatusError(String(e)); });
    };
    refreshStandalone();
    const refreshHistory = (): void => {
      void window.studio.history(selected).then(records => {
        if (!cancelled) { setHistory(records); setHistoryError(''); }
      }).catch(e => { if (!cancelled) setHistoryError(String(e)); });
    };
    refreshHistory();
    const timer = setInterval(() => { reload(); refreshStandalone(); refreshHistory(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [selected]);

  const loadIssues = async (): Promise<void> => {
    if (!selected) return;
    setIssuesLoading(true);
    setIssuesError('');
    setGitError('');
    void window.studio.gitPreflight(selected).then(setGitStatus).catch(e => setGitError(String(e)));
    try { setIssues(await window.studio.issues(selected)); }
    catch (error) { setIssuesError(String(error)); }
    finally { setIssuesLoading(false); }
  };

  const simulate = async (issueNumber: number): Promise<void> => {
    if (!selected || simulating !== null) return;
    setSimulating(issueNumber);
    setSimulation(null);
    setIssuesError('');
    try { setSimulation(await window.studio.simulateIssue(selected, issueNumber)); }
    catch (error) { setIssuesError(String(error)); }
    finally { setSimulating(null); }
  };

  const checkProviders = async (): Promise<void> => {
    if (!selected || checkingProviders) return;
    setCheckingProviders(true);
    setDiagnosticsError('');
    try { setDiagnostics(await window.studio.diagnostics(selected)); }
    catch (error) { setDiagnosticsError(String(error)); }
    finally { setCheckingProviders(false); }
  };

  const verifySandbox = async (): Promise<void> => {
    if (!selected || sandboxChecking) return;
    setSandboxChecking(true);
    setSandboxError('');
    setSandboxProbe(null);
    try { setSandboxProbe(await window.studio.sandboxProbe(selected)); }
    catch { setSandboxError('Sandbox-Test konnte nicht abgeschlossen werden.'); }
    finally { setSandboxChecking(false); }
  };

  const verifyReviewer = async (): Promise<void> => {
    if (!selected || reviewerChecking) return;
    setReviewerChecking(true);
    setReviewerProbe(null);
    try { setReviewerProbe(await window.studio.reviewerProbe(selected)); }
    catch { setReviewerProbe({supported:true,passed:false,reason:'tool-failed',detail:'sandbox-launch-failed'}); }
    finally { setReviewerChecking(false); }
  };

  const verifyQualitySandbox = async (): Promise<void> => {
    if (!selected || qualityChecking) return;
    setQualityChecking(true);
    setQualityProbe(null);
    try { setQualityProbe(await window.studio.qualityProbe(selected)); }
    catch { setQualityProbe({supported:true,passed:false,reason:'sandbox-failed',stage:'prepare',detail:'other',exitCode:null}); }
    finally { setQualityChecking(false); }
  };

  const verifyQualityScript = async (): Promise<void> => {
    if (!selected || qualityScriptChecking) return;
    setQualityScriptChecking(true);
    setQualityScriptProbe(null);
    try { setQualityScriptProbe(await window.studio.qualityScriptProbe(selected)); }
    catch { setQualityScriptProbe({passed:false,reason:'script-failed'}); }
    finally { setQualityScriptChecking(false); }
  };

  const verifyFullPipeline = async (): Promise<void> => {
    if (!selected || fullPipelineChecking) return;
    setFullPipelineChecking(true);
    setFullPipelineProbe(null);
    try { setFullPipelineProbe(await window.studio.fullPipelineProbe(selected)); }
    catch { setFullPipelineProbe({passed:false,reason:'pipeline-failed'}); }
    finally { setFullPipelineChecking(false); }
  };

  const verifyOfflineKilo = async (): Promise<void> => {
    if (!selected || offlineKiloChecking) return;
    setOfflineKiloChecking(true);
    setOfflineKiloProbe(null);
    try { setOfflineKiloProbe(await window.studio.offlineKiloProbe(selected)); }
    catch { setOfflineKiloProbe({passed:false,reason:'sandbox-failed'}); }
    finally { setOfflineKiloChecking(false); }
  };

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

  const viewHistoryLog = async (runId: string): Promise<void> => {
    if (!selected) return;
    setHistoryRun(runId);
    setSavedLog('Lade gespeichertes Protokoll …');
    try { setSavedLog(await window.studio.historyLog(selected, runId)); }
    catch (e) { setSavedLog(String(e)); }
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
      <div className="topbar-right"><span className="version">v0.2.3</span><span className={`status ${busy ? 'busy' : ''}`}>{busy ? 'Prozess läuft' : 'Bereit'}</span></div>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-title"><span>PROJEKTE</span><button type="button" title="Projekt hinzufügen" onClick={() => void add()}>+</button></div>
        <div className="project-list">{projects.length === 0
          ? <p className="muted">Noch kein Projekt hinzugefügt.</p>
          : projects.map(p => <button type="button" key={p.id} className={`project ${selected === p.id ? 'selected' : ''}`} onClick={() => { setSelected(p.id); setTab('overview'); }}>
            <strong>{p.name}</strong><small>{p.path}</small><small className={p.hasCore ? 'core-ready' : 'core-missing'}>{p.hasCore ? 'Git-Projekt · Legacy-Controller' : 'Git-Projekt · Studio-Engine'}</small>
          </button>)}</div>
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
          <button className={tab === 'logs' ? 'active' : ''} aria-current={tab === 'logs' ? 'page' : undefined} onClick={() => setTab('logs')}>Live-Protokoll {events.length > 0 ? <span className="count">{events.length}</span> : null}</button>
          <button className={tab === 'history' ? 'active' : ''} aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}>Verlauf</button>
          <button className={tab === 'issues' ? 'active' : ''} aria-current={tab === 'issues' ? 'page' : undefined} onClick={() => { setTab('issues'); void loadIssues(); }}>Issues</button>
        </nav>

        {tab === 'overview' && <div className="view overview">
          <div className="view-intro"><div><h2>Controller-Übersicht</h2><p>Zustand des ausgewählten Projekts · Aktualisierung alle 5 Sekunden</p></div></div>
          {project && !project.hasCore && (studioStatusError ? <div className="error" role="alert">Studio-Status nicht verfügbar: {studioStatusError}</div>
            : !studioStatus ? <div className="empty-state">Studio-Status wird geladen …</div>
              : <div className="studio-status-panel">
                  <div><small>Git-Branch</small><strong>{studioStatus.git.branch || 'Keiner'}</strong></div>
                  <div><small>Working Tree</small><strong>{studioStatus.git.clean ? 'Sauber' : 'Änderungen vorhanden'}</strong></div>
                  <div><small>Projektlock</small><strong>{studioStatus.lock.held ? 'Belegt' : 'Frei'}</strong></div>
                  <div><small>Checkpoint</small><strong>{studioStatus.checkpoint ? `#${studioStatus.checkpoint.issueNumber} · ${studioStatus.checkpoint.stage}` : 'Keiner'}</strong></div>
                  <p>Studio-Engine · {studioStatus.git.remoteSlug ?? 'Kein unterstütztes GitHub-Remote'} · Produktive Agentenläufe noch nicht freigegeben.</p>
                </div>)}
          {project?.hasCore && (snapshotError ? <div className="error" role="alert">{snapshotError}</div>
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
                  </>)}
          {project?.hasCore && <div className="quick-actions"><div><h3>Sicher ausprobieren</h3><p>Diese Aktionen starten weder Builder noch Git-Push.</p></div><div className="button-group"><button disabled={!canRun || busy} onClick={() => void run('status')}>Status abrufen</button><button disabled={!canRun || busy} onClick={() => void run('dry-run')}>Dry-Run starten</button></div></div>}
        </div>}

        {tab === 'agents' && <div className="view agents">
          <div className="view-intro agent-intro"><h2>Agentensteuerung</h2><button type="button" className="quiet agent-info-trigger" onClick={() => setAgentInfoOpen(true)} aria-haspopup="dialog" aria-label="Informationen zu Studio-Controller und Prozessstopp">ⓘ Info</button></div>
          <div className="metric-grid three">
            <div className="metric"><small>Agent / Modus</small><strong>{busy ? (activeInfo?.mode === 'execute' ? 'Builder → Reviewer' : activeInfo?.mode ?? 'Aktiv') : 'Bereit'}</strong></div>
            <div className="metric"><small>Laufzeit</small><strong className="mono">{duration}</strong></div>
            <div className="metric"><small>Checkpoint</small><strong>{snapshot?.checkpoint ? `#${snapshot.checkpoint.issueNumber} · ${snapshot.checkpoint.phase}` : 'Keiner'}</strong></div>
          </div>
          <div className="provider-panel">
            <div className="provider-heading"><div><h3>Lokale Provider</h3><p>Prüft nur Kilo CLI und GitHub-Anmeldung – keine Modellanfrage, keine Dateiänderungen.</p></div>
              <button disabled={!selected || checkingProviders} onClick={() => void checkProviders()}>{checkingProviders ? 'Prüfe …' : 'Umgebung prüfen'}</button></div>
            {diagnosticsError && <p className="error" role="alert">{diagnosticsError}</p>}
            {diagnostics && <div className="provider-results">
              <div><strong>Kilo CLI</strong><span>{diagnostics.kiloInstalled ? diagnostics.kiloVersion : 'Nicht gefunden'}</span><small>{diagnostics.kiloRunCommandReady ? 'CLI-Optionen erkannt' : 'CLI-Optionen unvollständig'} · {diagnostics.agentCatalogReadable ? 'Agentenliste abrufbar' : `Agentenliste: ${diagnostics.agentCatalogProblem === 'timeout' ? 'Zeitüberschreitung' : diagnostics.agentCatalogProblem === 'output-limit' ? 'Ausgabe zu groß' : diagnostics.agentCatalogProblem === 'not-found' ? 'Befehl fehlt' : diagnostics.agentCatalogProblem === 'empty-output' ? 'Leere Ausgabe' : 'CLI-Fehler'}`}</small><small>{diagnostics.sandboxTool ? `${diagnostics.sandboxTool}: ${diagnostics.sandboxToolAvailable ? 'Systemwerkzeug gefunden' : 'Nicht gefunden'}` : 'System-Sandbox: noch nicht unterstützt'} · Sandbox noch nicht validiert</small></div>
              <div><strong>GitHub CLI</strong><span>{diagnostics.ghInstalled ? 'Installiert' : 'Nicht gefunden'}</span><small>{diagnostics.ghAuthenticated ? 'GitHub-Anmeldung erkannt' : 'Keine gültige Anmeldung erkannt'}</small></div>
            </div>}
            <div className="sandbox-check"><button className="quiet" disabled={!selected || sandboxChecking || diagnostics?.sandboxTool !== 'bwrap' || !diagnostics.sandboxToolAvailable} onClick={() => void verifySandbox()}>{sandboxChecking ? 'Prüfe Sandbox …' : 'Sandbox testen'}</button><span>{sandboxError || (sandboxProbe ? sandboxProbe.isolated ? 'Schreibschutz und Start in Testumgebung bestätigt · Produktiv-Sandbox noch ausstehend' : `Sandbox-Test fehlgeschlagen: ${sandboxProbe.detail === 'namespace-permission-denied' ? 'User-Namespace nicht erlaubt' : sandboxProbe.detail === 'network-setup-denied' ? 'Netzwerk-Namespace blockiert' : sandboxProbe.detail === 'mount-setup-failed' ? 'Mount-Konfiguration fehlgeschlagen' : sandboxProbe.detail === 'timeout' ? 'Zeitüberschreitung' : sandboxProbe.detail === 'canary-read-failed' ? 'Testdatei innerhalb der Sandbox nicht lesbar' : sandboxProbe.detail === 'write-protection-failed' ? 'Schreibschutz nicht wirksam' : sandboxProbe.detail === 'canary-verification-failed' ? 'Testdatei nach Schreibversuch verändert' : sandboxProbe.detail === 'probe-command-failed' ? `Testbefehl fehlgeschlagen (Exit ${sandboxProbe.exitCode ?? '?'})` : 'Ursache unbekannt'}` : 'Separater Test ohne Kilo und ohne Projektänderungen')}</span></div>
            {sandboxProbe?.isolated && <div className="sandbox-check"><button className="quiet" disabled={!selected || reviewerChecking} onClick={() => void verifyReviewer()}>{reviewerChecking ? 'Prüfe Reviewer …' : 'Reviewer-Tool testen'}</button><span>{reviewerProbe ? reviewerProbe.passed ? 'Git-Prozess isoliert gestartet · Projekt weiterhin nur lesbar' : `Isolierter Git-Prozess fehlgeschlagen: ${reviewerProbe.detail === 'mountpoint-failed' ? 'Mount- oder Namespace-Konfiguration' : reviewerProbe.detail === 'runtime-library-missing' ? 'Laufzeitbibliothek fehlt' : reviewerProbe.detail === 'git-repository-rejected' ? 'Git-Repository in Sandbox nicht erkannt' : reviewerProbe.detail === 'git-command-failed' ? 'Git-Befehl fehlgeschlagen' : reviewerProbe.detail === 'timeout' ? 'Zeitüberschreitung' : 'Prozessstart fehlgeschlagen'}` : 'Prüft den tatsächlichen Git-Prozess in der Offline-Sandbox – ohne Modellaufruf'}</span></div>}
            {reviewerProbe?.passed && <div className="sandbox-check"><button className="quiet" disabled={!selected || qualityChecking} onClick={() => void verifyQualitySandbox()}>{qualityChecking ? 'Prüfe npm …' : 'Quality-Sandbox testen'}</button><span>{qualityProbe ? qualityProbe.passed ? 'npm in isolierter Testumgebung gestartet · keine Projektskripte ausgeführt' : qualityProbe.reason === 'npm-unavailable' ? 'System-npm unter /usr/bin/npm nicht gefunden' : qualityProbe.reason === 'invalid-output' ? 'npm-Version nicht erkannt' : `Quality-Sandbox: ${qualityProbe.stage === 'node' ? 'Node' : qualityProbe.stage === 'npm' ? 'npm' : 'Vorbereitung'} fehlgeschlagen${qualityProbe.detail ? ' · ' + (qualityProbe.detail === 'mount-or-namespace' ? 'Mount/Namespace' : qualityProbe.detail === 'runtime-library' ? 'Laufzeitdatei fehlt' : qualityProbe.detail === 'timeout' ? 'Zeitüberschreitung' : qualityProbe.detail === 'command-exit' ? 'Programmfehler' : 'Unbekannter Fehler') : ''}${qualityProbe.exitCode !== null ? ' (Exit ' + qualityProbe.exitCode + ')' : ''}` : 'Prüft ausschließlich npm --version in einem temporären Testverzeichnis'}</span></div>}
            {qualityProbe?.passed && <div className="sandbox-check"><button className="quiet" disabled={!selected || qualityScriptChecking} onClick={() => void verifyQualityScript()}>{qualityScriptChecking ? 'Prüfe Testskript …' : 'Quality-Skript testen'}</button><span>{qualityScriptProbe ? qualityScriptProbe.passed ? 'Testskript isoliert ausgeführt · Projektschreibzugriff erlaubt · .git geschützt' : qualityScriptProbe.reason === 'missing-expected-write' ? 'Testskript konnte nicht in das Testprojekt schreiben' : qualityScriptProbe.reason === 'git-metadata-modified' ? 'Git-Metadaten waren nicht ausreichend geschützt' : 'Isoliertes Testskript fehlgeschlagen' : 'Führt nur ein festes Testskript in einem temporären Projekt aus'}</span></div>}
            {qualityScriptProbe?.passed && <div className="sandbox-check"><button className="quiet" disabled={!selected || fullPipelineChecking} onClick={() => void verifyFullPipeline()}>{fullPipelineChecking ? 'Prüfe Workflow …' : 'Gesamtworkflow testen'}</button><span>{fullPipelineProbe ? fullPipelineProbe.passed ? 'Lokaler Trockenlauf erfolgreich · Git, Reviewer-Evidenz, Quality und Lock geprüft · keine Veröffentlichung' : fullPipelineProbe.reason === 'setup-failed' ? 'Temporäres Git-Testprojekt konnte nicht vorbereitet werden' : 'Lokaler Trockenlauf fehlgeschlagen · kein Projekt verändert' : 'Erzeugt ein Wegwerf-Git-Repository und testet die vollständige Schutzkette ohne KI und Push'}</span></div>}
            {fullPipelineProbe?.passed && <div className="sandbox-check"><button className="quiet" disabled={!selected || offlineKiloChecking} onClick={() => void verifyOfflineKilo()}>{offlineKiloChecking ? 'Prüfe Kilo …' : 'Kilo-Laufzeit testen'}</button><span>{offlineKiloProbe ? offlineKiloProbe.passed ? 'Kilo-CLI offline in privater Sandbox gestartet · keine Modellanfrage' : offlineKiloProbe.reason === 'cli-unavailable' ? 'Kilo weder im Studio-PATH noch in üblichen npm-Benutzerpfaden gefunden' : offlineKiloProbe.reason === 'cli-outside-usr' ? 'Kilo-Installationspfad nicht sicher freigebbar' : 'Kilo-CLI konnte in der privaten Sandbox nicht gestartet werden' : 'Startet ausschließlich kilo --version ohne Netzwerk, Zugangsdaten oder Projektzugriff'}</span></div>}
          </div>
          {snapshot?.checkpoint && <div className="checkpoint-detail">Checkpoint: {snapshot.checkpoint.reason} · Session: {snapshot.checkpoint.sessionId ?? 'Fehlt – Core muss Wiederaufnahme verweigern'}</div>}
          {canRun && <div className="run-panel"><div><h3>Legacy-Agentenlauf</h3><p>Kann Dateien ändern, committen, pushen und Issues schließen. Erfordert eine ausdrückliche Freigabe.</p></div><button className="danger" disabled={busy} onClick={() => { setApproval(''); setConfirmOpen(true); }}>Ausführung vorbereiten</button></div>}
        </div>}

        {tab === 'logs' && <div className="view log-view">
          <div className="log-toolbar"><div><h2>Live-Protokoll</h2><p>{busy ? `Laufender Prozess · ${duration}` : 'Ausgabe des letzten Laufs in dieser Sitzung'}</p></div><button className="quiet" disabled={busy} onClick={() => setEvents([])}>Protokoll leeren</button></div>
          {logs}
        </div>}

        {tab === 'history' && <div className="view history-view">
          <div className="view-intro"><h2>Laufhistorie</h2><p>Auf diesem Gerät gespeicherte Läufe – auch nach einem Neustart verfügbar. Maximale Loggröße: 5 MB je Lauf.</p></div>
          {historyError && <div className="error" role="alert">{historyError}</div>}
          {history.length === 0 ? <div className="empty-state">Für dieses Projekt sind noch keine Läufe gespeichert.</div> :
            <div className="history-layout"><div className="history-list">{history.map(record =>
              <button key={record.runId} className={`history-item ${historyRun === record.runId ? 'selected' : ''}`} onClick={() => void viewHistoryLog(record.runId)}>
                <span className="history-top"><strong>{record.mode === 'execute' ? 'Agentenlauf' : record.mode === 'dry-run' ? 'Dry-Run' : 'Statusabfrage'}</strong><span className={`outcome ${record.outcome}`}>{record.outcome === 'success' ? 'Erfolgreich' : record.outcome === 'running' ? 'Läuft' : record.outcome === 'interrupted' ? 'Unterbrochen' : 'Fehlgeschlagen'}</span></span>
                <small>{new Date(record.startedAt).toLocaleString('de-DE')} · {record.endedAt ? `${Math.round((record.endedAt - record.startedAt) / 1000)} s` : 'Noch aktiv'}</small>
              </button>)}</div>
              <div className="history-detail"><div className="history-detail-head"><strong>{historyRun ? `Lauf ${historyRun.slice(0, 8)}` : 'Lauf auswählen'}</strong><span className="muted">Gespeichertes Protokoll</span></div><pre className="saved-log">{historyRun ? savedLog || 'Keine Ausgabe gespeichert.' : 'Wähle links einen Lauf aus, um sein Protokoll anzuzeigen.'}</pre></div>
            </div>}
        </div>}

        {tab === 'issues' && <div className="view issue-view">
          <div className="view-intro issue-title"><div><h2>GitHub-Issues</h2><p>Projektunabhängig aus dem lokalen Git-Repository gelesen. Noch keine automatische Bearbeitung.</p></div>
            <button disabled={!selected || issuesLoading} onClick={() => void loadIssues()}>Aktualisieren</button></div>
          {gitStatus && <div className={`git-readiness ${gitStatus.canExecute ? 'ready' : 'needs-work'}`}><strong>{gitStatus.canExecute ? 'Git-Bereitschaft: geprüft' : 'Git: Vorbereitung erforderlich'}</strong><span>{gitStatus.remoteSlug ?? 'Ohne unterstütztes GitHub-Remote'} · {gitStatus.branch || 'Detached HEAD'}{gitStatus.reasons.length ? ` · ${gitStatus.reasons.join('; ')}` : ' · Sauberer Feature-Branch'}</span></div>}
          {gitError && <p className="muted">Git-Bereitschaft konnte nicht geprüft werden: {gitError}</p>}
          {issuesError && <div className="error" role="alert">{issuesError}</div>}
          {issuesLoading ? <div className="empty-state">Issues werden geladen …</div>
            : issues.length === 0 ? <div className="empty-state">Keine offenen Issues gefunden oder noch keine Abfrage ausgeführt.</div>
              : <div className="issue-list">{issues.map(issue => <article key={issue.number} className="issue-item">
                  <div><b>#{issue.number} · {issue.title}</b><p>{issue.labels.join(' · ') || 'Keine Labels'}</p></div>
                  <div className="issue-actions"><button disabled={simulating !== null} onClick={() => void simulate(issue.number)}>{simulating === issue.number ? 'Simuliere …' : 'Ablauf simulieren'}</button><a href={issue.url} target="_blank" rel="noopener noreferrer">Auf GitHub öffnen</a></div>
                </article>)}</div>}
          <div className="agent-footnote">Die Simulation nutzt bereits den eigenständigen Studio-Workflow. Produktive Builder-/Reviewer-Adapter und die automatische Issue-Abwicklung werden nach zusätzlichen Sicherheitsprüfungen freigegeben.</div>
        </div>}

        {error && <div className="error floating-error" role="alert">{error}<button onClick={() => setError('')}>Schließen</button></div>}
      </section>
    </div>

    {agentInfoOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setAgentInfoOpen(false); }}>
      <div className="modal agent-info-modal" role="dialog" aria-modal="true" aria-labelledby="agent-info-title" onKeyDown={event => { if (event.key === 'Escape') setAgentInfoOpen(false); }}>
        <div className="agent-info-header"><h2 id="agent-info-title">Hinweise zur Agentensteuerung</h2><button type="button" className="quiet" onClick={() => setAgentInfoOpen(false)}>Schließen</button></div>
        <h3>Studio-Controller</h3>
        <p>Der neue Studio-Controller ist für alle Git-Projekte vorgesehen. Produktive Agentenläufe bleiben bis zur sicheren Migration des Legacy-Controllers deaktiviert.</p>
        <h3>Stopp und Wiederaufnahme</h3>
        <p>Ein Stopp sendet SIGTERM und erforderlichenfalls SIGKILL. Er ist keine garantierte Checkpoint-Pause. Der Core prüft Wiederaufnahme und Doppelstarts.</p>
        <p>Bestehende produktive Läufe verwenden vorübergehend den LaceFrame-Legacy-Controller. Der unabhängige Studio-Workflow ist bereits separat testbar.</p>
      </div>
    </div>}
    {simulation && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSimulation(null); }}>
      <div className="modal simulation-modal" role="dialog" aria-modal="true" aria-labelledby="simulation-title">
        <div className="simulation-heading"><div><h2 id="simulation-title">Simulation · Issue #{simulation.state.issueNumber}</h2>
          <p>Ergebnis: {simulation.state.stage} · Korrekturrunden: {simulation.state.fixAttempts}</p></div>
          <button className="quiet" onClick={() => setSimulation(null)}>Schließen</button>
        </div>
        <div className="simulation-scroll">
          <div className="simulation-trace"><ol>{simulation.events.map((event, index) => <li key={index}><strong>{event.stage}</strong> – {event.message}</li>)}</ol></div>
          <p className="muted">Nur Simulation: keine Dateiänderungen, Modellaufrufe, Git-Commits oder GitHub-Mutationen.</p>
        </div>
      </div>
    </div>}
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
