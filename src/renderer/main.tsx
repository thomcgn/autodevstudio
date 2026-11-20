import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { StudioEvent } from '../main/preload';
import type { Project } from './global';
import './style.css';
function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('');
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async (): Promise<void> => {
    const all = await window.studio.projects(); setProjects(all);
    setSelected(current => all.some(p => p.id === current) ? current : all[0]?.id ?? '');
  };
  useEffect(() => {
    void refresh();
    void window.studio.active().then(setBusy);
    return window.studio.onEvent(event => {
      setEvents(previous => [...previous.slice(-1999), event]);
      if (event.type === 'start') setBusy(true);
      if (event.type === 'exit') setBusy(false);
    });
  }, []);
  const project = projects.find(p => p.id === selected);
  const add = async (): Promise<void> => { try { setError(''); const p = await window.studio.addProject(); await refresh(); if (p) setSelected(p.id); } catch (e) { setError(String(e)); } };
  const run = async (mode: 'status' | 'dry-run'): Promise<void> => {
    if (!selected) return;
    try { setError(''); setEvents([]); setBusy(true); await window.studio.start(selected, mode); }
    catch (e) { setError(String(e)); setBusy(false); }
  };
  return <main>
    <header><div><div className="eyebrow">LOCAL-FIRST AUTOMATION</div><h1>AutoDev <span>Studio</span></h1><p>Projektkontrolle und nachvollziehbare Agentenläufe. Keine Cloud-Anmeldung erforderlich.</p></div><div className="phase">PHASE 01 · SAFE MODE</div></header>
    <div className="layout"><aside><div className="section-head"><h2>Projekte</h2><button onClick={() => void add()}>+ Hinzufügen</button></div>
      {projects.length === 0 ? <p className="muted">Wähle dein LaceFrame-Verzeichnis aus, um AutoDev einzubinden.</p> : projects.map(p => <button key={p.id} className={'project '+(selected===p.id?'selected':'')} onClick={() => setSelected(p.id)}><b>{p.name}</b><small>{p.path}</small></button>)}
      <div className="aside-foot">Der Core bleibt im jeweiligen Projekt. Studio führt nur explizit erlaubte Befehle aus.</div>
    </aside><section><div className="panel"><div className="section-head"><div><h2>{project?.name ?? 'Kein Projekt ausgewählt'}</h2><p className="muted">{project?.path ?? 'Bitte ein Projekt hinzufügen'}</p></div><span className={'dot '+(busy?'running':'')}>{busy?'Läuft':'Bereit'}</span></div>
      <div className="actions"><button disabled={!selected||busy} onClick={() => void run('status')}>Status abrufen</button><button disabled={!selected||busy} onClick={() => void run('dry-run')}>Dry-Run starten</button><button className="danger" disabled={!busy} onClick={() => void window.studio.stop()}>Prozess stoppen</button></div>
      <p className="notice">Sicherheit: Produktive Builder-/Reviewer-Läufe, Git-Push und Issue-Abschluss sind in dieser Phase nicht über Studio startbar.</p></div>
      <div className="panel logs"><div className="section-head"><h2>Live-Protokoll</h2><button onClick={() => setEvents([])}>Leeren</button></div>
        <div className="console" role="log" aria-live="polite">{events.length===0?<span className="muted">Noch keine Ausgabe. Starte eine Statusabfrage oder einen Dry-Run.</span>:events.map((e,i)=><div key={i} className={'entry '+e.type}><time>{new Date(e.time).toLocaleTimeString('de-DE')}</time><span>{e.type === 'start' ? `Start: ${e.mode} · ${e.project}` : e.type==='exit' ? `Prozess beendet · Exit ${e.code ?? 'null'} · Signal ${e.signal ?? 'none'}` : e.message}</span></div>)}</div></div>
      {error&&<div className="error" role="alert">{error}</div>}
      </section></div>
    <footer>AutoDev Studio v0.1 · Linux / macOS / Windows · Electron + React + TypeScript</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
